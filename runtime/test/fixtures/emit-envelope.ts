const raw = process.argv[2];
if (!raw) {
  process.stderr.write("missing envelope\n");
  process.exit(2);
}
process.stdout.write(raw + "\n");
