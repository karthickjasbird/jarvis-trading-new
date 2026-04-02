import { execSync } from 'child_process';
try {
  execSync('kill -9 483');
  console.log('Killed 483');
} catch (e) {
  console.error('Failed to kill 483');
}
