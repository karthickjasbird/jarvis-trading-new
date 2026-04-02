import { execSync } from 'child_process';
try {
  const output = execSync('ps -ef | grep "tsx.*server.ts"').toString();
  console.log(output);
  const lines = output.split('\n');
  for (const line of lines) {
    if (line.includes('grep')) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length > 1) {
      const pid = parts[1];
      console.log(`Killing PID ${pid}`);
      try {
        execSync(`kill -9 ${pid}`);
      } catch (e) {}
    }
  }
} catch (e) {
  console.error('ps failed');
}
