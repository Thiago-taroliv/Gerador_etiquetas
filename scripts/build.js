const fs = require('fs');
const path = require('path');

// Caminhos dos arquivos
const examplePath = path.join(__dirname, '../js/config.example.js');
const configPath = path.join(__dirname, '../js/config.js');

// 1. Lemos o arquivo de exemplo (template)
let configContent = fs.readFileSync(examplePath, 'utf8');

// 2. Pegamos os valores das variáveis de ambiente (do Vercel)
// Se não existirem, usaremos os placeholders do exemplo
const url = process.env.SUPABASE_URL || 'SUA_URL_AQUI';
const key = process.env.SUPABASE_ANON_KEY || 'SUA_CHAVE_ANONIMA_AQUI';

// 3. Substituímos os placeholders pelos valores reais
configContent = configContent
    .replace('SUA_URL_AQUI', url)
    .replace('SUA_CHAVE_ANONIMA_AQUI', key);

// 4. Criamos o arquivo js/config.js final para o site funcionar
fs.writeFileSync(configPath, configContent);

console.log('✅ js/config.js gerado com sucesso para o deploy!');
