const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const express = require('express');

// ============ CONFIGURAÇÕES ============
const BOT_TOKEN = '8642593414:AAFjKWsd9za1jIeHLpDlVfobyca1SiaAhGM';
const GEMINI_API_KEY = 'AIzaSyBbFcGJYvNN-b-i2tlkiZrY7jZ_pjEij4A';
const XROCKET_API = 'c01709a9c058bd25eeefea6b2';
const ADMIN_ID = 7991785009;

// ============ PROMPT IA GEMINI ============
const IA_PROMPT = `Você é um copywriter especialista em vendas. Crie uma descrição atraente, persuasiva e curta para o seguinte produto. Use emojis e destaque benefícios. Máximo 200 caracteres.`;

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

// ============ BANCO DE DADOS ============
let produtos = [];
let carrinho = new Map();
let pedidos = new Map();
let cupons = [
    { codigo: 'XROCKET10', desconto: 10, tipo: 'percentual', usos: 0, maxUsos: 100, ativo: true },
    { codigo: 'FREEBOSS', desconto: 100, tipo: 'percentual', usos: 0, maxUsos: 1, ativo: true },
    { codigo: 'BEMVINDO', desconto: 15, tipo: 'percentual', usos: 0, maxUsos: 50, ativo: true }
];

// ============ FUNÇÃO IA GEMINI ============
async function gerarDescricaoComIA(nomeProduto) {
    if (!GEMINI_API_KEY) return null;
    
    try {
        const response = await axios.post(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
            {
                contents: [{
                    parts: [{ text: `${IA_PROMPT}\n\nProduto: ${nomeProduto}` }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 150,
                    topP: 0.9
                }
            },
            {
                params: { key: GEMINI_API_KEY },
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000
            }
        );
        
        const descricao = response.data.candidates?.[0]?.content?.parts?.[0]?.text || null;
        return descricao ? descricao.replace(/\n/g, ' ').substring(0, 200) : null;
    } catch (error) {
        console.error('❌ Erro na IA:', error.response?.data || error.message);
        return null;
    }
}

// ============ FUNÇÃO PAGAMENTO xROCKET ============
async function criarPagamento(items, compradorId, cupom = null) {
    if (!XROCKET_API) return null;
    
    let total = items.reduce((s, i) => s + (i.preco * (i.qtd || 1)), 0);
    
    if (cupom) {
        if (cupom.tipo === 'percentual') {
            total *= (1 - cupom.desconto / 100);
        } else {
            total = Math.max(0, total - cupom.desconto);
        }
    }
    
    try {
        const res = await axios.post(
            'https://api.xrocketpay.com/v1/invoice',
            {
                amount: parseFloat(total.toFixed(2)),
                currency: 'USDT',
                description: `Compra de ${items.length} produto(s)`,
                external_id: `order_${compradorId}_${Date.now()}`,
                expires_in: 3600
            },
            {
                headers: { 'Authorization': `Bearer ${XROCKET_API}` },
                timeout: 10000
            }
        );
        
        return { url: res.data.payment_url, total: total, id: res.data.id };
    } catch (error) {
        console.error('❌ Erro no pagamento:', error.message);
        return null;
    }
}

function isAdmin(ctx) {
    return ctx.from.id === ADMIN_ID;
}

function formatarNumero(numero) {
    return numero.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ============ MENUS ============
const mainMenu = Markup.inlineKeyboard([
    [Markup.button.callback('🛍️ CATÁLOGO', 'products')],
    [Markup.button.callback('🛒 CARRINHO', 'cart')],
    [Markup.button.callback('🎫 CUPONS', 'coupons')],
    [Markup.button.callback('📦 MEUS PEDIDOS', 'my_orders')],
    [Markup.button.callback('⚙️ ADMIN', 'admin')]
]);

const adminMenu = Markup.inlineKeyboard([
    [Markup.button.callback('🤖 Add com IA', 'add_ia')],
    [Markup.button.callback('📝 Add manual', 'add_manual')],
    [Markup.button.callback('📋 Listar produtos', 'list')],
    [Markup.button.callback('🎫 Criar cupom', 'create_coupon')],
    [Markup.button.callback('📊 Estatísticas', 'stats')],
    [Markup.button.callback('🔙 Voltar', 'back')]
]);

// ============ COMANDO START ============
bot.start(async (ctx) => {
    const adminStatus = isAdmin(ctx) ? '👑 ADMINISTRADOR' : '👤 CLIENTE';
    const boasVindas = `🚀 *Bem-vindo ao xROCKET FLOW!*\n\n` +
        `📌 *Status:* ${adminStatus}\n` +
        `📦 *Produtos:* ${produtos.length}\n` +
        `🤖 *IA Gemini:* ${GEMINI_API_KEY ? 'ATIVA ✅' : 'INATIVA ⚠️'}\n` +
        `💳 *Pagamentos:* ${XROCKET_API ? 'xRocket ✅' : 'Não configurado'}\n\n` +
        `🎯 *Como usar:*\n` +
        `• Navegue pelo catálogo\n` +
        `• Adicione itens ao carrinho\n` +
        `• Aplique cupons de desconto\n` +
        `• Finalize sua compra\n\n` +
        `Use os botões abaixo para começar!`;
    
    await ctx.reply(boasVindas, {
        parse_mode: 'Markdown',
        ...mainMenu
    });
});

// ============ CATÁLOGO DE PRODUTOS ============
bot.action('products', async (ctx) => {
    if (produtos.length === 0) {
        return ctx.reply('📦 *Nenhum produto disponível no momento.*\n\nAguarde novidades em breve!', {
            parse_mode: 'Markdown'
        });
    }
    
    let msg = '*🛍️ CATÁLOGO DE PRODUTOS:*\n\n';
    const btns = [];
    
    for (let i = 0; i < produtos.length; i++) {
        const p = produtos[i];
        msg += `*${p.nome}*\n`;
        msg += `💰 Preço: *$${formatarNumero(p.preco)} USDT*\n`;
        msg += `📝 ${p.descricao || 'Sem descrição'}\n`;
        msg += `━━━━━━━━━━━━━━━━\n\n`;
        btns.push([Markup.button.callback(`➕ ${p.nome}`, `add_${i}`)]);
    }
    
    btns.push([Markup.button.callback('🔙 Voltar ao menu', 'back')]);
    
    await ctx.reply(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(btns)
    });
});

// ============ ADICIONAR AO CARRINHO ============
bot.action(/add_(\d+)/, async (ctx) => {
    const idx = parseInt(ctx.match[1]);
    const prod = produtos[idx];
    
    if (!prod) {
        return ctx.answerCbQuery('❌ Produto não encontrado!');
    }
    
    let cart = carrinho.get(ctx.from.id) || [];
    const existente = cart.find(p => p.id === idx);
    
    if (existente) {
        existente.qtd = (existente.qtd || 1) + 1;
    } else {
        cart.push({ ...prod, id: idx, qtd: 1 });
    }
    
    carrinho.set(ctx.from.id, cart);
    await ctx.answerCbQuery(`✅ ${prod.nome} adicionado ao carrinho!`);
});

// ============ VER CARRINHO ============
bot.action('cart', async (ctx) => {
    const cart = carrinho.get(ctx.from.id) || [];
    
    if (cart.length === 0) {
        return ctx.reply('🛒 *Seu carrinho está vazio!*\n\nAdicione produtos pelo catálogo.', {
            parse_mode: 'Markdown'
        });
    }
    
    let msg = '*🛒 SEU CARRINHO:*\n\n';
    let total = 0;
    
    for (let i = 0; i < cart.length; i++) {
        const item = cart[i];
        const subtotal = item.preco * (item.qtd || 1);
        total += subtotal;
        msg += `*${item.nome}*\n`;
        msg += `💰 $${formatarNumero(item.preco)} x ${item.qtd || 1} = *$${formatarNumero(subtotal)}*\n`;
        msg += `━━━━━━━━━━━━━━━━\n\n`;
    }
    
    msg += `\n💰 *TOTAL: $${formatarNumero(total)} USDT*`;
    
    const botoesCarrinho = [];
    for (let i = 0; i < cart.length; i++) {
        botoesCarrinho.push([Markup.button.callback(`🗑️ Remover ${cart[i].nome}`, `remove_${i}`)]);
    }
    botoesCarrinho.push([Markup.button.callback('✅ FINALIZAR COMPRA', 'checkout')]);
    botoesCarrinho.push([Markup.button.callback('🎫 APLICAR CUPOM', 'apply_coupon')]);
    botoesCarrinho.push([Markup.button.callback('🗑️ LIMPAR CARRINHO', 'clear_cart')]);
    botoesCarrinho.push([Markup.button.callback('🔙 Voltar ao menu', 'back')]);
    
    await ctx.reply(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(botoesCarrinho)
    });
});

// ============ REMOVER ITEM DO CARRINHO ============
bot.action(/remove_(\d+)/, async (ctx) => {
    const idx = parseInt(ctx.match[1]);
    let cart = carrinho.get(ctx.from.id) || [];
    
    if (cart[idx]) {
        const nome = cart[idx].nome;
        cart.splice(idx, 1);
        carrinho.set(ctx.from.id, cart);
        await ctx.answerCbQuery(`🗑️ ${nome} removido!`);
        await ctx.reply(`✅ *${nome}* removido do carrinho.`, { parse_mode: 'Markdown' });
    }
});

// ============ LIMPAR CARRINHO ============
bot.action('clear_cart', async (ctx) => {
    carrinho.delete(ctx.from.id);
    await ctx.answerCbQuery('🗑️ Carrinho esvaziado!');
    await ctx.reply('✅ *Carrinho esvaziado com sucesso!*', {
        parse_mode: 'Markdown',
        ...mainMenu
    });
});

// ============ FINALIZAR COMPRA ============
bot.action('checkout', async (ctx) => {
    const cart = carrinho.get(ctx.from.id) || [];
    
    if (cart.length === 0) {
        return ctx.reply('❌ *Carrinho vazio!*\n\nAdicione produtos antes de finalizar.', {
            parse_mode: 'Markdown'
        });
    }
    
    await ctx.reply('🔄 *Gerando pagamento...*\n\nAguarde um momento.', { 
        parse_mode: 'Markdown' 
    });
    
    const cupomAplicado = ctx.session?.cupom;
    const payment = await criarPagamento(cart, ctx.from.id, cupomAplicado);
    
    if (payment?.url) {
        const pedidoId = Date.now();
        pedidos.set(pedidoId, {
            id: pedidoId,
            usuario: ctx.from.id,
            itens: [...cart],
            total: payment.total,
            cupom: cupomAplicado,
            data: new Date(),
            status: 'Aguardando pagamento'
        });
        
        await ctx.reply(
            `💳 *PAGAMENTO GERADO!*\n\n` +
            `🔗 *Link para pagamento:*\n${payment.url}\n\n` +
            `💰 *Total:* $${formatarNumero(payment.total)} USDT\n` +
            `⏰ *Válido por:* 1 hora\n` +
            `🆔 *Pedido:* #${pedidoId}\n\n` +
            `⚠️ *Após o pagamento*, você receberá a confirmação.`,
            { parse_mode: 'Markdown' }
        );
        
        carrinho.delete(ctx.from.id);
        delete ctx.session?.cupom;
    } else {
        await ctx.reply(
            '❌ *Erro ao gerar pagamento!*\n\n' +
            'Tente novamente mais tarde.',
            { parse_mode: 'Markdown' }
        );
    }
});

// ============ MEUS PEDIDOS ============
bot.action('my_orders', async (ctx) => {
    const meusPedidos = [];
    for (const [id, pedido] of pedidos) {
        if (pedido.usuario === ctx.from.id) {
            meusPedidos.push(pedido);
        }
    }
    
    if (meusPedidos.length === 0) {
        return ctx.reply('📦 *Você não possui pedidos ainda.*', {
            parse_mode: 'Markdown'
        });
    }
    
    let msg = '*📦 MEUS PEDIDOS:*\n\n';
    for (const pedido of meusPedidos.slice(-5)) {
        msg += `🆔 *Pedido #${pedido.id}*\n`;
        msg += `📅 ${pedido.data.toLocaleString()}\n`;
        msg += `💰 Total: $${formatarNumero(pedido.total)}\n`;
        msg += `📦 Status: ${pedido.status}\n`;
        msg += `━━━━━━━━━━━━━━━━\n\n`;
    }
    
    await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ============ CUPONS ============
bot.action('coupons', async (ctx) => {
    const cuponsAtivos = cupons.filter(c => c.ativo && c.usos < c.maxUsos);
    
    if (cuponsAtivos.length === 0) {
        return ctx.reply('🎫 *Nenhum cupom ativo no momento.*', {
            parse_mode: 'Markdown'
        });
    }
    
    let msg = '🎫 *CUPONS DISPONÍVEIS:*\n\n';
    for (const c of cuponsAtivos) {
        msg += `*${c.codigo}*\n`;
        msg += `💰 ${c.desconto}% de desconto\n`;
        msg += `📊 Usos: ${c.usos}/${c.maxUsos}\n`;
        msg += `━━━━━━━━━━━━━━━━\n\n`;
    }
    
    await ctx.reply(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Voltar ao menu', 'back')]
        ])
    });
});

bot.action('apply_coupon', async (ctx) => {
    ctx.session = { step: 'awaiting_coupon_code' };
    await ctx.reply('🎫 *Digite o código do cupom:*\n\nExemplo: `XROCKET10`', {
        parse_mode: 'Markdown'
    });
});

// ============ ADMIN ============
bot.action('admin', async (ctx) => {
    if (!isAdmin(ctx)) {
        return ctx.reply('❌ *Acesso negado!*', {
            parse_mode: 'Markdown'
        });
    }
    await ctx.reply('⚙️ *Painel de Administração - xROCKET FLOW*', {
        parse_mode: 'Markdown',
        ...adminMenu
    });
});

// ============ ADMIN: ESTATÍSTICAS ============
bot.action('stats', async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    const totalVendas = Array.from(pedidos.values()).reduce((s, p) => s + p.total, 0);
    const totalPedidos = pedidos.size;
    const totalProdutos = produtos.length;
    const totalCupons = cupons.length;
    
    const msg = `📊 *ESTATÍSTICAS DO xROCKET FLOW*\n\n` +
        `📦 *Produtos:* ${totalProdutos}\n` +
        `🎫 *Cupons:* ${totalCupons}\n` +
        `💰 *Vendas:* $${formatarNumero(totalVendas)} USDT\n` +
        `📦 *Pedidos:* ${totalPedidos}\n` +
        `👥 *Clientes ativos:* ${carrinho.size}\n` +
        `🤖 *IA:* ${GEMINI_API_KEY ? 'ATIVA' : 'INATIVA'}\n` +
        `💳 *xRocket:* ${XROCKET_API ? 'CONFIGURADO' : 'NÃO CONFIGURADO'}`;
    
    await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ============ ADMIN: ADD COM IA ============
bot.action('add_ia', async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    ctx.session = { step: 'awaiting_ia_product' };
    await ctx.reply(
        '🤖 *ADICIONAR PRODUTO COM IA*\n\n' +
        'Envie o *NOME* do produto e a IA criará a descrição automaticamente.\n\n' +
        '📝 Exemplo: `Curso de JavaScript Avançado`',
        { parse_mode: 'Markdown' }
    );
});

// ============ ADMIN: ADD MANUAL ============
bot.action('add_manual', async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    ctx.session = { step: 'awaiting_manual_product' };
    await ctx.reply(
        '📝 *ADICIONAR PRODUTO MANUALMENTE*\n\n' +
        'Envie no formato:\n' +
        '`Nome do produto`\n' +
        '`Preço`\n' +
        '`Descrição`\n\n' +
        '📝 Exemplo:\n' +
        'Curso de Python\n' +
        '49.90\n' +
        'Curso completo com 100 horas de aula',
        { parse_mode: 'Markdown' }
    );
});

// ============ ADMIN: LISTAR PRODUTOS ============
bot.action('list', async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    if (produtos.length === 0) {
        return ctx.reply('📋 *Nenhum produto cadastrado.*', {
            parse_mode: 'Markdown'
        });
    }
    
    let msg = '*📋 LISTA DE PRODUTOS:*\n\n';
    produtos.forEach((p, i) => {
        msg += `*${i + 1}.* ${p.nome}\n`;
        msg += `   💰 $${formatarNumero(p.preco)} USDT\n`;
        msg += `   📝 ${p.descricao?.substring(0, 50)}...\n\n`;
    });
    
    await ctx.reply(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Voltar ao admin', 'admin')]
        ])
    });
});

// ============ ADMIN: CRIAR CUPOM ============
bot.action('create_coupon', async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    ctx.session = { step: 'awaiting_coupon' };
    await ctx.reply(
        '🎫 *CRIAR NOVO CUPOM*\n\n' +
        'Envie no formato:\n' +
        '`CODIGO|DESCONTO|MAX_USOS`\n\n' +
        'Exemplo: `BLACK20|20|100`',
        { parse_mode: 'Markdown' }
    );
});

// ============ VOLTAR ============
bot.action('back', async (ctx) => {
    await ctx.reply('🏠 *Menu Principal - xROCKET FLOW*', {
        parse_mode: 'Markdown',
        ...mainMenu
    });
});

// ============ PROCESSAR TEXTOS ============
bot.on('text', async (ctx) => {
    // Aplicar cupom na compra
    if (ctx.session?.step === 'awaiting_coupon_code') {
        const codigo = ctx.message.text.toUpperCase();
        const cupom = cupons.find(c => c.codigo === codigo && c.ativo && c.usos < c.maxUsos);
        
        if (cupom) {
            ctx.session.cupom = cupom;
            await ctx.reply(
                `✅ *Cupom aplicado com sucesso!*\n\n` +
                `🎫 ${cupom.codigo}: ${cupom.desconto}% de desconto\n\n` +
                `Continue sua compra no carrinho.`,
                { parse_mode: 'Markdown' }
            );
        } else {
            await ctx.reply('❌ *Cupom inválido ou expirado!*', {
                parse_mode: 'Markdown'
            });
        }
        ctx.session.step = null;
        return;
    }
    
    // Admin: Adicionar produto com IA
    if (ctx.session?.step === 'awaiting_ia_product' && isAdmin(ctx)) {
        const nomeProduto = ctx.message.text.trim();
        
        await ctx.reply(`🤖 *Gerando descrição para:*\n"${nomeProduto}"\n\n⏳ Aguarde...`, {
            parse_mode: 'Markdown'
        });
        
        const descricaoIA = await gerarDescricaoComIA(nomeProduto);
        
        produtos.push({
            nome: nomeProduto,
            preco: 0,
            descricao: descricaoIA || 'Produto de alta qualidade',
            criadoPorIA: !!descricaoIA,
            dataCriacao: new Date()
        });
        
        const idx = produtos.length - 1;
        
        await ctx.reply(
            `✅ *Produto adicionado com sucesso!*\n\n` +
            `📦 *Nome:* ${nomeProduto}\n` +
            `🤖 *Descrição IA:* ${descricaoIA || 'Gerada manualmente'}\n\n` +
            `⚠️ *Agora edite o preço:*\n` +
            `Envie: /preco ${idx} VALOR\n\n` +
            `📝 Exemplo: /preco ${idx} 49.90`,
            { parse_mode: 'Markdown' }
        );
        
        ctx.session = {};
        return;
    }
    
    // Admin: Adicionar produto manual
    if (ctx.session?.step === 'awaiting_manual_product' && isAdmin(ctx)) {
        const lines = ctx.message.text.split('\n');
        
        if (lines.length < 2) {
            return ctx.reply('❌ *Formato inválido!*\n\nUse:\n`Nome\nPreço\nDescrição`', {
                parse_mode: 'Markdown'
            });
        }
        
        const nome = lines[0].trim();
        const preco = parseFloat(lines[1]);
        const descricao = lines[2] || '';
        
        if (isNaN(preco)) {
            return ctx.reply('❌ *Preço inválido!* Use números.', { parse_mode: 'Markdown' });
        }
        
        produtos.push({
            nome: nome,
            preco: preco,
            descricao: descricao,
            criadoPorIA: false,
            dataCriacao: new Date()
        });
        
        await ctx.reply(
            `✅ *Produto adicionado!*\n\n` +
            `📦 *Nome:* ${nome}\n` +
            `💰 *Preço:* $${formatarNumero(preco)} USDT\n` +
            `📝 *Descrição:* ${descricao || 'Sem descrição'}`,
            { parse_mode: 'Markdown' }
        );
        
        ctx.session = {};
        return;
    }
    
    // Admin: Criar cupom
    if (ctx.session?.step === 'awaiting_coupon' && isAdmin(ctx)) {
        const parts = ctx.message.text.split('|');
        
        if (parts.length < 2) {
            return ctx.reply('❌ *Formato inválido!*\n\nUse: `CODIGO|DESCONTO|MAX_USOS`', {
                parse_mode: 'Markdown'
            });
        }
        
        const codigo = parts[0].toUpperCase();
        const desconto = parseFloat(parts[1]);
        const maxUsos = parts[2] ? parseInt(parts[2]) : 100;
        
        if (isNaN(desconto)) {
            return ctx.reply('❌ *Desconto inválido!*', { parse_mode: 'Markdown' });
        }
        
        cupons.push({
            codigo: codigo,
            desconto: desconto,
            tipo: 'percentual',
            usos: 0,
            maxUsos: maxUsos,
            ativo: true,
            dataCriacao: new Date()
        });
        
        await ctx.reply(
            `✅ *Cupom criado com sucesso!*\n\n` +
            `🎫 *Código:* ${codigo}\n` +
            `💰 *Desconto:* ${desconto}%\n` +
            `📊 *Usos máximos:* ${maxUsos}`,
            { parse_mode: 'Markdown' }
        );
        
        ctx.session = {};
        return;
    }
    
    // Admin: Editar preço
    if (ctx.message.text.startsWith('/preco') && isAdmin(ctx)) {
        const parts = ctx.message.text.split(' ');
        const idx = parseInt(parts[1]);
        const preco = parseFloat(parts[2]);
        
        if (!isNaN(idx) && !isNaN(preco) && produtos[idx]) {
            produtos[idx].preco = preco;
            await ctx.reply(
                `✅ *Preço atualizado!*\n\n` +
                `📦 *Produto:* ${produtos[idx].nome}\n` +
                `💰 *Novo preço:* $${formatarNumero(preco)} USDT`,
                { parse_mode: 'Markdown' }
            );
        } else {
            await ctx.reply(
                '❌ *Comando inválido!*\n\n' +
                `Use: /preco ID VALOR\n\n` +
                `📝 Exemplo: /preco 0 49.90`,
                { parse_mode: 'Markdown' }
            );
        }
    }
});

// ============ WEBHOOK xROCKET ============
app.post('/webhook/xrocket', async (req, res) => {
    console.log('📥 Webhook recebido:', req.body);
    
    const { status, external_id, amount } = req.body;
    
    if (status === 'paid') {
        const orderId = parseInt(external_id?.split('_')[1]);
        if (orderId && pedidos.has(orderId)) {
            const pedido = pedidos.get(orderId);
            pedido.status = 'Pago ✅';
            pedidos.set(orderId, pedido);
            
            await bot.telegram.sendMessage(ADMIN_ID, 
                `💰 *NOVO PAGAMENTO RECEBIDO!*\n\n` +
                `🆔 Pedido: #${orderId}\n` +
                `💰 Valor: $${amount}\n` +
                `👤 Usuário: ${pedido.usuario}`,
                { parse_mode: 'Markdown' }
            );
        }
    }
    
    res.json({ ok: true });
});

// ============ SERVIDOR ============
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        bot: 'xROCKET FLOW',
        version: '2.0.0',
        produtos: produtos.length,
        pedidos: pedidos.size,
        admin: ADMIN_ID
    });
});

app.listen(PORT, () => {
    console.log(`✅ Servidor rodando na porta ${PORT}`);
    bot.launch();
    console.log('🚀 xROCKET FLOW BOT iniciado com sucesso!');
    console.log(`👑 Admin ID: ${ADMIN_ID}`);
    console.log(`🤖 IA Gemini: ${GEMINI_API_KEY ? 'ATIVA ✅' : 'INATIVA ⚠️'}`);
    console.log(`💳 xRocket: ${XROCKET_API ? 'CONFIGURADO ✅' : 'NÃO CONFIGURADO ⚠️'}`);
    console.log(`📦 Produtos carregados: ${produtos.length}`);
});

process.once('SIGINT', () => {
    console.log('🛑 Desligando o bot...');
    bot.stop('SIGINT');
    process.exit(0);
});

process.once('SIGTERM', () => {
    console.log('🛑 Desligando o bot...');
    bot.stop('SIGTERM');
    process.exit(0);
});
