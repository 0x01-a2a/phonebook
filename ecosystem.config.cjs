// PM2 ecosystem config — PhoneBook backend
// Użycie na Hetznerze:
//   pm2 start ecosystem.config.cjs
//   pm2 save
//   pm2 startup  (uruchom wydrukowaną komendę sudo jako root)
//
// Używamy tsx zamiast skompilowanego dist/ bo @phonebook/database
// nie ma osobnego build step (main: "./src/index.ts")
module.exports = {
  apps: [
    {
      name: 'phonebook-api',
      script: 'node_modules/.bin/tsx',
      args: 'apps/backend/src/index.ts',
      cwd: '/opt/phonebook',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      out_file: '/var/log/phonebook/api-out.log',
      error_file: '/var/log/phonebook/api-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
