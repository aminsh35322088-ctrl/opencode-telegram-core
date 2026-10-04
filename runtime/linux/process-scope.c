/* Candidate scope runner: one scope, never a replacement runtime authority.
 * Private Unix socket: P pause, R resume, K retire; EOF retires.
 * Receipts: S ready, P paused, R resumed, D confirmed empty.
 * Invoke: scope transient|persistent socket-path command args...
 */
#define _GNU_SOURCE
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <poll.h>
#include <signal.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <dirent.h>
#include <sys/socket.h>
#include <sys/un.h>

static volatile sig_atomic_t retiring;
static int frozen[4096], nfrozen;
static pid_t frozen_pid[4096];
static int control;
static void stop(int sig) { (void)sig; retiring = 1; }
static long now(void) {
  struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec * 1000 + t.tv_nsec / 1000000;
}
static void fail(const char *what) { perror(what); _exit(125); }
static int pidfd(pid_t pid) { return syscall(SYS_pidfd_open, pid, 0); }
static int signal_pidfd(int fd, int sig) {
  if (syscall(SYS_pidfd_send_signal, fd, sig, NULL, 0) == 0) return 1;
  if (errno == ESRCH) return 0;
  fail("pidfd_send_signal"); return 0;
}
static int dead(int fd) {
  struct pollfd p = { .fd = fd, .events = POLLIN };
  int n = poll(&p, 1, 0); if (n < 0) fail("poll pidfd"); return n > 0;
}
static void receipt(char value) { if (write(control, &value, 1) != 1) fail("receipt"); }
static int children(pid_t pid, pid_t *pids) {
  DIR *dir = opendir("/proc"); if (!dir) fail("proc directory");
  struct dirent *entry; int count = 0;
  while ((entry = readdir(dir))) {
    char *end; long id = strtol(entry->d_name, &end, 10);
    if (*end || id < 1) continue;
    char name[128], text[4096], state; long parent;
    snprintf(name, sizeof(name), "/proc/%ld/stat", id);
    FILE *f = fopen(name, "r");
    if (!f) { if (errno == ENOENT) continue; fail("child stat"); }
    char *read = fgets(text, sizeof(text), f); fclose(f);
    if (!read) continue;
    char *tail = strrchr(text, ')');
    if (!tail || sscanf(tail+1, " %c %ld", &state, &parent) != 2) fail("child parse");
    if (parent != pid) continue;
    if (count == 4096) fail("child bound");
    pids[count++] = id;
  }
  closedir(dir); return count;
}
static int stopped_threads(pid_t pid) {
  char name[128]; snprintf(name, sizeof(name), "/proc/%d/task", pid);
  DIR *dir = opendir(name);
  if (!dir) { if (errno == ENOENT) return 0; fail("freeze tasks"); }
  struct dirent *entry; int stopped = 1;
  while ((entry = readdir(dir))) {
    char *end; long tid = strtol(entry->d_name, &end, 10);
    if (*end || tid < 1) continue;
    snprintf(name, sizeof(name), "/proc/%d/task/%ld/stat", pid, tid);
    FILE *f = fopen(name, "r");
    if (!f) { if (errno == ENOENT) continue; fail("freeze thread stat"); }
    char text[4096]; char *read = fgets(text, sizeof(text), f); fclose(f);
    if (!read) fail("freeze thread read");
    char *tail = strrchr(text, ')'); if (!tail) fail("freeze thread parse");
    char state = tail[2];
    if (state != 'T' && state != 't' && state != 'Z' && state != 'X') stopped = 0;
  }
  closedir(dir); return stopped;
}
/* Freeze parents before reading their children. A stopped, live parent cannot
 * reap/reuse those child PIDs. Our own direct children cannot be reused until
 * we reap them. pidfds keep every later signal tied to that exact identity. */
static void freeze(pid_t pid, int fd, long deadline, int depth) {
  for (int i = 0; i < nfrozen; i++) if (frozen_pid[i] == pid) { close(fd); return; }
  if (depth > 128 || nfrozen == 4096) fail("tree bound");
  if (!signal_pidfd(fd, SIGSTOP)) { close(fd); return; }
  char name[128], text[4096], state = 0;
  snprintf(name, sizeof(name), "/proc/%d/stat", pid);
  while (!dead(fd)) {
    FILE *f = fopen(name, "r");
    if (!f) fail("freeze stat");
    if (!fgets(text, sizeof(text), f)) fail("freeze read");
    fclose(f);
    char *tail = strrchr(text, ')'); if (!tail) fail("freeze parse");
    state = tail[2]; if ((state == 'T' || state == 't') && stopped_threads(pid)) break;
    if (now() > deadline) fail("freeze deadline");
    usleep(1000);
  }
  if (dead(fd)) { close(fd); return; }
  frozen_pid[nfrozen] = pid; frozen[nfrozen++] = fd;
  pid_t pids[4096]; int n = children(pid, pids);
  for (int i = 0; i < n; i++) {
    int child = pidfd(pids[i]);
    if (child < 0) { if (errno == ESRCH) continue; fail("child pidfd"); }
    freeze(pids[i], child, deadline, depth+1);
  }
}
static void resume(void) {
  for (int i = nfrozen-1; i >= 0; i--) { signal_pidfd(frozen[i], SIGCONT); close(frozen[i]); }
  nfrozen = 0;
}
int main(int argc, char **argv) {
  if (argc < 4) return 125;
  int persistent = !strcmp(argv[1], "persistent");
  if (!persistent && strcmp(argv[1], "transient")) return 125;
  if (prctl(PR_SET_CHILD_SUBREAPER, 1)) fail("subreaper");
  int probe = pidfd(getpid()); if (probe < 0) fail("pidfd support"); close(probe);
  signal(SIGTERM, stop); signal(SIGINT, stop); signal(SIGPIPE, SIG_IGN);
  control = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0); if (control < 0) fail("control socket");
  struct sockaddr_un address = { .sun_family = AF_UNIX };
  if (strlen(argv[2]) >= sizeof(address.sun_path)) fail("socket path bound");
  strcpy(address.sun_path, argv[2]); long connecting = now()+1000;
  while (connect(control, (struct sockaddr *)&address, sizeof(address))) {
    if ((errno != ENOENT && errno != ECONNREFUSED && errno != EINTR) || now() > connecting) fail("control connect");
    usleep(1000);
  }
  if (fcntl(control, F_SETFL, O_NONBLOCK) < 0) fail("control fd");
  int exec_error[2]; if (pipe2(exec_error, O_CLOEXEC)) fail("exec status pipe");
  pid_t root = fork(); if (root < 0) fail("fork");
  if (!root) {
    close(exec_error[0]);
    close(control);
    signal(SIGTERM, SIG_DFL); signal(SIGINT, SIG_DFL); signal(SIGPIPE, SIG_DFL);
    if (setsid() >= 0) execvp(argv[3], argv+3);
    unsigned char error = errno; ssize_t written;
    do { written = write(exec_error[1], &error, 1); } while (written < 0 && errno == EINTR);
    _exit(written == 1 ? 127 : 125);
  }
  close(exec_error[1]);
  unsigned char error; ssize_t error_bytes;
  do { error_bytes = read(exec_error[0], &error, 1); } while (error_bytes < 0 && errno == EINTR);
  if (error_bytes < 0) fail("exec status read");
  close(exec_error[0]);
  if (error_bytes) { receipt('E'); receipt(error); }
  receipt('S');
  int root_done = 0, result = 125, paused = 0; long deadline = 0;
  for (;;) {
    int status; pid_t got;
    while ((got = waitpid(-1, &status, WNOHANG)) > 0) if (got == root) {
      root_done = 1;
      result = WIFEXITED(status) ? WEXITSTATUS(status) : 128+WTERMSIG(status);
      if (!persistent) retiring = 1;
    }
    if (got < 0 && errno != ECHILD && errno != EINTR) fail("waitpid");
    if (retiring && got < 0 && errno == ECHILD) { receipt('D'); return result; }
    if (retiring) {
      if (!deadline) deadline = now()+5000;
      pid_t pids[4096]; int n = children(getpid(), pids);
      for (int i = 0; i < n; i++) {
        int fd = pidfd(pids[i]);
        if (fd < 0) { if (errno == ESRCH) continue; fail("retire pidfd"); }
        signal_pidfd(fd, SIGKILL); close(fd);
      }
      if (now() > deadline) fail("retirement deadline");
    } else {
      char command; ssize_t n = read(control, &command, 1);
      if (!n) retiring = 1;
      else if (n < 0 && errno != EAGAIN && errno != EINTR) fail("control read");
      else if (n == 1) {
        if (command == 'K') retiring = 1;
        else if (command == 'R') { resume(); paused = 0; receipt('R'); }
        else if (command == 'P') {
          if (!paused) {
          int previous; long until = now()+1000;
          do {
            previous = nfrozen;
            pid_t pids[4096]; int count = children(getpid(), pids);
            for (int i = 0; i < count; i++) {
              int fd = pidfd(pids[i]); if (fd < 0) fail("pause pidfd");
              freeze(pids[i], fd, until, 0);
            }
          } while (previous != nfrozen);
          }
          paused = 1; receipt('P');
        } else if (command != 'P') fail("invalid command");
      }
    }
    (void)root_done;
    usleep(1000);
  }
}
