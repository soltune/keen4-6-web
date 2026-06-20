/* IO.H stub — Borland low-level file I/O (open/read/write/close/lseek...). */
#ifndef CK_STUB_IO_H
#define CK_STUB_IO_H

#include "ck_dos_compat.h"
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>

/* Borland filelength(handle) — size of an open file descriptor. */
static inline long filelength(int handle) {
    struct stat st;
    if (fstat(handle, &st) != 0) return -1L;
    return (long)st.st_size;
}

#endif /* CK_STUB_IO_H */
