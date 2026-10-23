// Original Seven Code Android PTY bridge. No code copied from other terminal projects.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <jni.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

static void throw_io(JNIEnv *env, const char *message) {
    jclass clazz = (*env)->FindClass(env, "java/io/IOException");
    if (clazz != NULL) (*env)->ThrowNew(env, clazz, message);
}

JNIEXPORT jintArray JNICALL
Java_dev_seven_code_terminal_SevenPty_nativeSpawn(
    JNIEnv *env, jclass clazz, jstring cwd, jint cols, jint rows) {
    (void)clazz;
    if (cwd == NULL || cols < 1 || rows < 1 || cols > 1000 || rows > 1000) {
        throw_io(env, "Invalid PTY directory or dimensions");
        return NULL;
    }
    const char *directory = (*env)->GetStringUTFChars(env, cwd, NULL);
    if (directory == NULL) return NULL;

    char home[PATH_MAX + 6];
    char tmpdir[PATH_MAX + 8];
    if (snprintf(home, sizeof(home), "HOME=%s", directory) >= (int)sizeof(home) ||
        snprintf(tmpdir, sizeof(tmpdir), "TMPDIR=%s", directory) >= (int)sizeof(tmpdir)) {
        (*env)->ReleaseStringUTFChars(env, cwd, directory);
        throw_io(env, "Workspace path exceeds OS limit");
        return NULL;
    }

    int master = posix_openpt(O_RDWR | O_NOCTTY | O_CLOEXEC);
    char slave_name[128];
    if (master < 0 || grantpt(master) != 0 || unlockpt(master) != 0 ||
        ptsname_r(master, slave_name, sizeof(slave_name)) != 0) {
        if (master >= 0) close(master);
        (*env)->ReleaseStringUTFChars(env, cwd, directory);
        throw_io(env, "Cannot create Android pseudoterminal");
        return NULL;
    }

    const struct winsize size = { .ws_row = (unsigned short)rows,
        .ws_col = (unsigned short)cols, .ws_xpixel = 0, .ws_ypixel = 0 };
    if (ioctl(master, TIOCSWINSZ, &size) != 0) {
        close(master);
        (*env)->ReleaseStringUTFChars(env, cwd, directory);
        throw_io(env, "Cannot resize Android pseudoterminal");
        return NULL;
    }

    // All argv/env allocations are prepared before fork(). No Java/JNI calls in child.
    char *const argv[] = { "/system/bin/sh", "-i", NULL };
    char *const envp[] = {
        home, tmpdir, "PATH=/system/bin:/system/xbin", "TERM=xterm-256color",
        "LANG=C.UTF-8", "LC_ALL=C.UTF-8", NULL
    };
    pid_t pid = fork();
    if (pid == 0) {
        if (setsid() < 0) _exit(126);
        int slave = open(slave_name, O_RDWR);
        if (slave < 0) _exit(126);
        if (ioctl(slave, TIOCSCTTY, 0) < 0) _exit(126);
        if (dup2(slave, STDIN_FILENO) < 0 ||
            dup2(slave, STDOUT_FILENO) < 0 ||
            dup2(slave, STDERR_FILENO) < 0) _exit(126);
        if (slave > STDERR_FILENO) close(slave);
        close(master);
        if (chdir(directory) != 0) _exit(126);
        execve("/system/bin/sh", argv, envp);
        _exit(127);
    }

    (*env)->ReleaseStringUTFChars(env, cwd, directory);
    if (pid < 0) {
        close(master);
        throw_io(env, "Android shell fork failed");
        return NULL;
    }
    jint values[] = { (jint)master, (jint)pid };
    jintArray result = (*env)->NewIntArray(env, 2);
    if (result == NULL) {
        kill(-pid, SIGHUP);
        kill(pid, SIGTERM);
        close(master);
        return NULL;
    }
    (*env)->SetIntArrayRegion(env, result, 0, 2, values);
    return result;
}

JNIEXPORT jbyteArray JNICALL
Java_dev_seven_code_terminal_SevenPty_nativeRead(
    JNIEnv *env, jclass clazz, jint fd) {
    (void)clazz;
    if (fd < 0) { throw_io(env, "Invalid PTY descriptor"); return NULL; }
    struct pollfd p = { .fd = fd, .events = POLLIN | POLLHUP };
    int ready;
    do { ready = poll(&p, 1, 100); } while (ready < 0 && errno == EINTR);
    if (ready < 0) { throw_io(env, "PTY poll failed"); return NULL; }
    if (ready == 0) return (*env)->NewByteArray(env, 0);
    char buffer[4096];
    ssize_t n;
    do { n = read(fd, buffer, sizeof(buffer)); } while (n < 0 && errno == EINTR);
    if (n < 0 && errno == EIO) return NULL; // PTY closed by child
    if (n < 0) { throw_io(env, "PTY read failed"); return NULL; }
    if (n == 0) return NULL;
    jbyteArray result = (*env)->NewByteArray(env, n);
    if (result != NULL) (*env)->SetByteArrayRegion(env, result, 0, n, (const jbyte*)buffer);
    return result;
}

JNIEXPORT void JNICALL
Java_dev_seven_code_terminal_SevenPty_nativeWrite(
    JNIEnv *env, jclass clazz, jint fd, jbyteArray bytes) {
    (void)clazz;
    if (fd < 0 || bytes == NULL) { throw_io(env, "Invalid PTY write"); return; }
    jsize length = (*env)->GetArrayLength(env, bytes);
    if (length > 65536) { throw_io(env, "Terminal input exceeds 64 KiB"); return; }
    jbyte *buffer = (*env)->GetByteArrayElements(env, bytes, NULL);
    if (buffer == NULL) return;
    size_t offset = 0;
    while (offset < (size_t)length) {
        ssize_t n = write(fd, buffer + offset, (size_t)length - offset);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) {
            (*env)->ReleaseByteArrayElements(env, bytes, buffer, JNI_ABORT);
            throw_io(env, "PTY write failed"); return;
        }
        offset += (size_t)n;
    }
    (*env)->ReleaseByteArrayElements(env, bytes, buffer, JNI_ABORT);
}

JNIEXPORT void JNICALL
Java_dev_seven_code_terminal_SevenPty_nativeResize(
    JNIEnv *env, jclass clazz, jint fd, jint cols, jint rows) {
    (void)clazz;
    if (fd < 0 || cols < 1 || rows < 1 || cols > 1000 || rows > 1000) {
        throw_io(env, "Invalid resize dimensions"); return;
    }
    struct winsize size = { .ws_row = (unsigned short)rows, .ws_col = (unsigned short)cols };
    if (ioctl(fd, TIOCSWINSZ, &size) != 0) throw_io(env, "PTY resize failed");
}

JNIEXPORT void JNICALL
Java_dev_seven_code_terminal_SevenPty_nativeTerminate(
    JNIEnv *env, jclass clazz, jint fd, jint pid) {
    (void)env; (void)clazz;
    if (pid > 1) { kill(-pid, SIGHUP); kill(pid, SIGTERM); }
    if (fd >= 0) close(fd);
}

JNIEXPORT jint JNICALL
Java_dev_seven_code_terminal_SevenPty_nativeReap(
    JNIEnv *env, jclass clazz, jint pid) {
    (void)env; (void)clazz;
    int status = 0;
    if (pid <= 1) return -1;
    pid_t done = waitpid(pid, &status, WNOHANG);
    if (done == 0) return 0;
    if (done < 0) return -1;
    return WIFEXITED(status) ? (WEXITSTATUS(status) + 1) : 129;
}

JNIEXPORT void JNICALL
Java_dev_seven_code_terminal_SevenPty_nativeKill(
    JNIEnv *env, jclass clazz, jint pid) {
    (void)env; (void)clazz;
    if (pid > 1) { kill(-pid, SIGKILL); kill(pid, SIGKILL); }
}
