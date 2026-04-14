const fs = require('fs');
const path = require('path');

// Caminhos dos arquivos
// Usando require.resolve para garantir que o caminho seja absoluto e correto no ambiente Vercel
const examplePath = path.join(__dirname, '../js/config.example.js');
const configPath = path.join(__dirname, '../js/config.js');

console.log('--- Iniciando build do js/config.js ---');

try {
    // 1. Lemos o arquivo de exemplo (template)
    if (!fs.existsSync(examplePath)) {
        throw new Error(`Arquivo de exemplo não encontrado em: ${examplePath}`);
    }
    
    let configContent = fs.readFileSync(examplePath, 'utf8');

    // 2. Pegamos os valores das variáveis de ambiente (do Vercel)
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
        console.warn('⚠️  Aviso: SUPABASE_URL ou SUPABASE_ANON_KEY não encontradas no process.env.');
        console.log('Usando placeholders padrão.');
    } else {
        console.log('✅ Variáveis de ambiente detectadas. Substituindo...');
        
        // 3. Substituímos os placeholders pelos valores reais
        // Usando regex com 'g' para substituir todas as ocorrências
        configContent = configContent
            .replace(/SUA_URL_AQUI/g, url)
            .replace(/SUA_CHAVE_ANONIMA_AQUI/g, key);
    }

    // 4. Criamos o arquivo js/config.js final
    fs.writeFileSync(configPath, configContent);
    console.log('✅ js/config.js gerado com sucesso!');

} catch (err) {
    console.error('❌ Erro durante o build:', err.message);
    process.exit(1); // Força falha no build se houver erro crítico
}
