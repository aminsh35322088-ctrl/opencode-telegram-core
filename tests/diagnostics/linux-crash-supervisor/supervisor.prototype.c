#define _GNU_SOURCE
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <sys/file.h>
#include <fcntl.h>
#include <unistd.h>
#include <signal.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <dirent.h>
#include <string.h>
#include <time.h>
static volatile sig_atomic_t stop_signal;
static void requested(int sig) { stop_signal=sig; }
static int open_pid(pid_t pid) { return syscall(SYS_pidfd_open,pid,0); }
static int signal_pid(int fd,int sig) { return syscall(SYS_pidfd_send_signal,fd,sig,NULL,0); }
static long millis(void) { struct timespec ts; clock_gettime(CLOCK_MONOTONIC,&ts); return ts.tv_sec*1000+ts.tv_nsec/1000000; }
static void terminate_children(void) {
 DIR *dir=opendir("/proc"); if(!dir) { perror("proc"); exit(125); }
 struct dirent *entry;
 while((entry=readdir(dir))) {
  char *end; long pid=strtol(entry->d_name,&end,10); if(*end||pid<1) continue;
  char name[128],line[4096];snprintf(name,sizeof(name),"/proc/%ld/stat",pid);
  FILE *f=fopen(name,"r");if(!f) continue;
  char *read=fgets(line,sizeof(line),f);fclose(f);if(!read)continue;
  char *fields=strrchr(line,')'), state;long ppid;
  if(!fields||sscanf(fields+1," %c %ld",&state,&ppid)!=2||ppid!=getpid())continue;
  // No other thread reaps this child. It cannot be reused before pidfd_open.
  int fd=open_pid(pid);if(fd<0) {if(errno==ESRCH)continue;perror("pidfd_open");exit(125);}
  if(signal_pid(fd,SIGKILL)<0&&errno!=ESRCH){perror("pidfd_send_signal");exit(125);}
  close(fd);
 }
 closedir(dir);
}
int main(int argc,char **argv) {
 if(argc<3) return 125;
 int lock=open(argv[1],O_CREAT|O_RDWR|O_CLOEXEC|O_NOFOLLOW,0600);
 if(lock<0||flock(lock,LOCK_EX|LOCK_NB)) { perror("replacement fenced"); return 125; }
 if(prctl(PR_SET_CHILD_SUBREAPER,1)) {perror("subreaper");return 125;}
 int probe=open_pid(getpid()); if(probe<0) {perror("pidfd unsupported");return 125;} close(probe);
 signal(SIGTERM,requested);signal(SIGINT,requested);
 pid_t parent=getpid(),child=fork();
 if(child<0) return 125;
 if(!child) {
  if(prctl(PR_SET_PDEATHSIG,SIGKILL)||getppid()!=parent) _exit(125);
  execv(argv[2],argv+2);perror("exec");_exit(125);
 }
 int childfd=open_pid(child); if(childfd<0) {kill(child,SIGKILL);return 125;}
 int dead=0,result=125;long deadline=0,stop_deadline=0;
 for(;;) {
  int status;pid_t got;
  while((got=waitpid(-1,&status,WNOHANG))>0) if(got==child) {
   dead=1;result=WIFEXITED(status)?WEXITSTATUS(status):128+WTERMSIG(status);deadline=millis()+5000;
  }
  if(got<0&&errno==ECHILD) return result;
  if(stop_signal&&!dead) {signal_pid(childfd,stop_signal);stop_signal=0;if(!stop_deadline)stop_deadline=millis()+5000;}
  if(stop_deadline&&!dead&&millis()>stop_deadline) signal_pid(childfd,SIGKILL);
  if(dead) {
   terminate_children();
   if(millis()>deadline) {fputs("uncertain retirement; replacement remains fenced\n",stderr);for(;;)pause();}
  }
  struct timespec delay={.tv_nsec=10000000};nanosleep(&delay,NULL);
 }
}
