/*
 * Narrow Android API 26 compatibility for Linux ARM64 Copilot ELF research.
 *
 * These implementations preserve Linux syscall semantics (including errno,
 * short reads, AT_EMPTY_PATH and statx mask bits), rather than fake success.
 * They do not address the much larger glibc ABI and executable-loader gap.
 *
 * Copyright Seven Code contributors. MIT license (see LICENSE).
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/stat.h>
#include <stdint.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <unistd.h>

#if defined(__aarch64__) && defined(__ANDROID__)

/*
 * getrandom(2) is present on Linux >=3.17 even if Bionic's public symbol was
 * not exposed in API 26. The flags and return value are forwarded untouched.
 * An unsupported syscall must still return ENOSYS; never downgrade to an
 * unsafe random source or report success without entropy.
 */
ssize_t getrandom(void *buffer, size_t size, unsigned int flags) {
#if defined(__NR_getrandom)
    return syscall(__NR_getrandom, buffer, size, flags);
#else
    (void)buffer;
    (void)size;
    (void)flags;
    errno = ENOSYS;
    return -1;
#endif
}

/* glibc getentropy(3): all requested bytes or -1; maximum 256 bytes. */
int getentropy(void *buffer, size_t size) {
    if (size > 256) {
        errno = EIO;
        return -1;
    }
    if (size == 0) return 0;
    unsigned char *out = (unsigned char *)buffer;
    size_t done = 0;
    while (done < size) {
        ssize_t n = getrandom(out + done, size - done, 0);
        if (n < 0) {
            if (errno == EINTR) continue;
            return -1;
        }
        if (n == 0) {
            errno = EIO;
            return -1;
        }
        done += (size_t)n;
    }
    return 0;
}

/*
 * Preserve kernel statx(2) byte layout. Android kernels without the syscall
 * return ENOSYS, in which case fstatat fills only STATX_BASIC_STATS. Birth
 * time, mounts and attributes remain unspecified; we never fabricate them.
 *
 * This fallback does not claim all statx features (such as STATX_DIOALIGN).
 */
static void seven_fill_timestamp(struct statx_timestamp *dest,
                                 const struct timespec *source) {
    dest->tv_sec = source->tv_sec;
    dest->tv_nsec = (uint32_t)source->tv_nsec;
    dest->__reserved = 0;
}
static unsigned int seven_dev_major(uint64_t dev) {
    return (unsigned int)(((dev >> 8) & 0xfffU) | ((dev >> 32) & 0xfffff000U));
}
static unsigned int seven_dev_minor(uint64_t dev) {
    return (unsigned int)((dev & 0xffU) | ((dev >> 12) & 0xffffff00U));
}

int statx(int dirfd, const char *path, int flags, unsigned int mask,
          struct statx *result) {
#if defined(__NR_statx)
    int rc = (int)syscall(__NR_statx, dirfd, path, flags, mask, result);
    if (rc == 0 || errno != ENOSYS) return rc;
#endif
    struct stat old;
    int rc2;
#ifdef AT_EMPTY_PATH
    if (path != NULL && path[0] == '\0' && (flags & AT_EMPTY_PATH)) {
        rc2 = fstat(dirfd, &old);
    } else
#endif
    {
        rc2 = fstatat(dirfd, path, &old, flags & AT_SYMLINK_NOFOLLOW);
    }
    if (rc2 < 0) return -1;
    if (!result) {
        errno = EFAULT;
        return -1;
    }
    memset(result, 0, sizeof(*result));
    result->stx_mask = STATX_BASIC_STATS;
    result->stx_blksize = (uint32_t)old.st_blksize;
    result->stx_nlink = (uint32_t)old.st_nlink;
    result->stx_uid = old.st_uid;
    result->stx_gid = old.st_gid;
    result->stx_mode = (uint16_t)old.st_mode;
    result->stx_ino = (uint64_t)old.st_ino;
    result->stx_size = (uint64_t)old.st_size;
    result->stx_blocks = (uint64_t)old.st_blocks;
    result->stx_rdev_major = seven_dev_major((uint64_t)old.st_rdev);
    result->stx_rdev_minor = seven_dev_minor((uint64_t)old.st_rdev);
    result->stx_dev_major = seven_dev_major((uint64_t)old.st_dev);
    result->stx_dev_minor = seven_dev_minor((uint64_t)old.st_dev);
    seven_fill_timestamp(&result->stx_atime, &old.st_atim);
    seven_fill_timestamp(&result->stx_btime, &(struct timespec){0, 0});
    seven_fill_timestamp(&result->stx_ctime, &old.st_ctim);
    seven_fill_timestamp(&result->stx_mtime, &old.st_mtim);
    return 0;
}
#endif
