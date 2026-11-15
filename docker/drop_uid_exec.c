#define _GNU_SOURCE
#include <errno.h>
#include <grp.h>
#include <linux/capability.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <unistd.h>

extern char **environ;

#ifndef DEVICE_UID
#define DEVICE_UID 10001
#endif
#ifndef DEVICE_GID
#define DEVICE_GID 10001
#endif
#ifndef TOOL_UID
#define TOOL_UID 10002
#endif
#ifndef TOOL_GID
#define TOOL_GID 10002
#endif

static void fail(const char *message) {
    fprintf(stderr, "drop-uid-exec: %s: %s\n", message, strerror(errno));
    _exit(126);
}

int main(int argc, char **argv) {
    if (getuid() != DEVICE_UID || geteuid() != 0 || getgid() != DEVICE_GID) {
        fprintf(stderr, "drop-uid-exec: caller identity rejected\n");
        return 126;
    }
    int separator = 1;
    gid_t workspace_group = 0;
    int has_workspace_group = 0;
    if (argc >= 4 && strcmp(argv[1], "--workspace-gid") == 0) {
        if (argv[2][0] != '\0') {
            errno = 0;
            char *end = NULL;
            unsigned long parsed = strtoul(argv[2], &end, 10);
            if (errno != 0 || end == argv[2] || *end != '\0' || parsed == 0 || parsed > 65535) {
                fprintf(stderr, "drop-uid-exec: invalid workspace group id\n");
                return 126;
            }
            workspace_group = (gid_t)parsed;
            has_workspace_group = 1;
        }
        separator = 3;
    }
    if (argc < separator + 2 || strcmp(argv[separator], "--") != 0 || argv[separator + 1][0] != '/') {
        fprintf(stderr, "drop-uid-exec: expected -- /absolute/program [args...]\n");
        return 126;
    }

    gid_t supplementary_groups[2] = {TOOL_GID, workspace_group};
    size_t supplementary_count = has_workspace_group && workspace_group != TOOL_GID ? 2 : 1;
    if (setgroups(supplementary_count, supplementary_groups) != 0) fail("setgroups");
    umask(0007);
    if (setresgid(TOOL_GID, TOOL_GID, TOOL_GID) != 0) fail("setresgid");
    if (setresuid(TOOL_UID, TOOL_UID, TOOL_UID) != 0) fail("setresuid");
    if (prctl(PR_CAP_AMBIENT, PR_CAP_AMBIENT_CLEAR_ALL, 0, 0, 0) != 0) fail("clear ambient capabilities");

    struct __user_cap_header_struct header = {
        .version = _LINUX_CAPABILITY_VERSION_3,
        .pid = 0,
    };
    struct __user_cap_data_struct caps[2] = {{0}};
    if (syscall(SYS_capset, &header, caps) != 0) fail("capset");
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) fail("PR_SET_NO_NEW_PRIVS");

    execve(argv[separator + 1], &argv[separator + 1], environ);
    fail("execve");
    return 126;
}
