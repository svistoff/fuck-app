const path = require('path');

// Два сервиса одного проекта:
//   gorod-dating   — Node (сайт знакомств + блог /blog), :8080
//   content-radar  — Python-завод (content.<домен>), :8000
// Завод запускается из своего venv (см. content-radar/README). Если гоняешь
// завод в Docker (docker compose up -d в content-radar/), убери второй блок.
module.exports = {
  apps: [
    {
      name: 'gorod-dating',
      script: 'src/server.js',
      cwd: __dirname,
      env: { NODE_ENV: 'production' },
      max_memory_restart: '300M',
    },
    {
      name: 'content-radar',
      script: '.venv/bin/uvicorn',
      args: 'app.main:app --host 127.0.0.1 --port 8000',
      interpreter: 'none',
      cwd: path.join(__dirname, 'content-radar'),
      max_memory_restart: '500M',
    },
  ],
};
