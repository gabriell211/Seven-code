/*
 * Experimental Android/Bionic GNU symbol compatibility for Copilot research.
 * This adapter intentionally remains outside the release APK until an
 * actual ARM64 Android test runs the original GitHub Copilot end-to-end.
 *
 * secure_getenv has GNU semantics: never expose environment variables to a
 * process started in secure-execution mode (AT_SECURE). Android exposes
 * getauxval through Bionic starting below the Seven Code minSdk.
 */
#include <stdlib.h>
#include <sys/auxv.h>
#include <elf.h>

char *secure_getenv(const char *name) {
    if (name == NULL || getauxval(AT_SECURE) != 0) {
        return NULL;
    }
    return getenv(name);
}
