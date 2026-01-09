// ============================================================
// BOT WHATSAPP AXELLABOTTECHNOLOGY v2.0
// Optimizado para producción en Render
// Implementaciones: Keep-alive, Reconexión Inteligente, Logs Críticos
// ============================================================

require("dotenv").config();

const baileys = require("@whiskeysockets/baileys");
const makeWASocket = baileys.default;
const useMultiFileAuthState = baileys.useMultiFileAuthState;
const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
const DisconnectReason = baileys.DisconnectReason;
const fs = require('fs');

const { GoogleGenerativeAI } = require("@google/generative-ai");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const http = require("http");
const nodemailer = require("nodemailer");

// ============================================================
// CONFIGURACIÓN DE LOGS CRÍTICOS
// Solo errores importantes, sin ruido de Baileys
// ============================================================

const CRITICAL_LOG = {
    error: (context, error) => {
        console.error(`❌ [${context}] ${error.message || error}`);
    },
    warn: (context, message) => {
        console.warn(`⚠️  [${context}] ${message}`);
    },
    info: (context, message) => {
        console.log(`ℹ️  [${context}] ${message}`);
    },
    success: (context, message) => {
        console.log(`✅ [${context}] ${message}`);
    }
};

// ============================================================
// HEALTH CHECK MEJORADO PARA RENDER
// Endpoint para monitoreo de Render
// ============================================================

let lastMessageTimestamp = Date.now();
let isSocketConnected = false;

const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        const uptime = process.uptime();
        const memoryUsage = process.memoryUsage();
        const isHealthy = isSocketConnected && (Date.now() - lastMessageTimestamp < 300000); // 5 min

        res.writeHead(isHealthy ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: isHealthy ? 'healthy' : 'unhealthy',
            uptime: Math.floor(uptime),
            memory: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
            socket: isSocketConnected ? 'connected' : 'disconnected',
            lastActivity: new Date(lastMessageTimestamp).toISOString()
        }));
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end("Bot Activo - Axellabottechnology v2.0");
    }
});

server.listen(process.env.PORT || 4000, () => {
    CRITICAL_LOG.success('SERVER', `HTTP Server listening on port ${process.env.PORT || 4000}`);
});

// ============================================================
// CONFIGURACIÓN DE GEMINI CON CIRCUIT BREAKER
// Evita saturación de la API con reintentos inteligentes
// ============================================================

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

// Circuit Breaker para Gemini
const geminiCircuit = {
    failures: 0,
    maxFailures: 3,
    resetTimeout: 60000, // 1 minuto
    isOpen: false,
    lastFailTime: null,

    recordFailure() {
        this.failures++;
        this.lastFailTime = Date.now();
        if (this.failures >= this.maxFailures) {
            this.isOpen = true;
            CRITICAL_LOG.warn('GEMINI', `Circuit breaker OPEN - Too many failures (${this.failures})`);
            setTimeout(() => this.reset(), this.resetTimeout);
        }
    },

    recordSuccess() {
        this.failures = 0;
        this.isOpen = false;
    },

    reset() {
        this.failures = 0;
        this.isOpen = false;
        CRITICAL_LOG.info('GEMINI', 'Circuit breaker RESET');
    },

    canExecute() {
        return !this.isOpen;
    }
};

// ============================================================
// CONFIGURACIÓN DE EMAIL CON VALIDACIÓN
// ============================================================

const CONTACT_EMAIL = process.env.CONTACT_EMAIL;
const SENDER_EMAIL = process.env.EMAIL_USER;
const SENDER_PASS = process.env.EMAIL_PASS;

if (!CONTACT_EMAIL || !SENDER_EMAIL || !SENDER_PASS) {
    CRITICAL_LOG.error('CONFIG', 'Missing email configuration in .env');
}

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: SENDER_EMAIL,
        pass: SENDER_PASS
    },
    pool: true,
    maxConnections: 5,
    maxMessages: 10
});

async function sendEmail(subject, body) {
    try {
        await transporter.sendMail({
            from: `"Bot Axellabottechnology" <${SENDER_EMAIL}>`,
            to: CONTACT_EMAIL,
            subject: subject,
            text: body,
        });
        CRITICAL_LOG.success('EMAIL', `Sent: ${subject}`);
        return true;
    } catch (error) {
        CRITICAL_LOG.error('EMAIL', error);
        return false;
    }
}

// ============================================================
// SISTEMA DE MENSAJES PROGRAMADOS
// ============================================================

const TARGET_GROUP_ID = "120363321342714715@g.us";

const SCHEDULED_TIMES = [
    { hour: 7, minute: 15 },
    { hour: 14, minute: 30 },
    { hour: 20, minute: 0 }
];

let messagesSentToday = new Set();

const SCHEDULED_MESSAGE_TEXT = `📢 *¡REGISTRA TU NEGOCIO!* 📢

🔹 Únete a nuestro canal de WhatsApp:
https://whatsapp.com/channel/0029Vb638WkBqbrCCtfqDl3b

📝 Ingresa tus datos en nuestro formulario:
https://docs.google.com/forms/d/e/1FAIpQLScs0piRlqjGgGpTjgErf4qhm1CC87ItHHLf6DvouVydrwq_mQ/viewform?usp=header

✅ ¡Es rápido y sin costo!`;

async function sendScheduledMessage(sock, scheduleTime) {
    const now = new Date();
    const todayKey = now.toDateString();
    const timeKey = `${todayKey}-${scheduleTime.hour}:${scheduleTime.minute}`;

    if (messagesSentToday.has(timeKey)) return;

    try {
        const imagePath = './Imagenes/LogotipoEmpresa.png';
        
        if (fs.existsSync(imagePath)) {
            await sock.sendMessage(TARGET_GROUP_ID, {
                image: fs.readFileSync(imagePath),
                caption: SCHEDULED_MESSAGE_TEXT
            });
        } else {
            await sock.sendMessage(TARGET_GROUP_ID, {
                text: SCHEDULED_MESSAGE_TEXT
            });
        }

        messagesSentToday.add(timeKey);
        CRITICAL_LOG.success('SCHEDULED', `Message sent at ${scheduleTime.hour}:${scheduleTime.minute}`);
    } catch (error) {
        CRITICAL_LOG.error('SCHEDULED', error);
    }
}

function scheduleMessages(sock) {
    setInterval(() => {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        
        SCHEDULED_TIMES.forEach(scheduleTime => {
            if (currentHour === scheduleTime.hour && currentMinute === scheduleTime.minute) {
                sendScheduledMessage(sock, scheduleTime);
            }
        });
        
        if (currentHour === 0 && currentMinute === 1) {
            messagesSentToday.clear();
            CRITICAL_LOG.info('SCHEDULED', 'Daily message log cleared');
        }
    }, 60000);

    CRITICAL_LOG.info('SCHEDULED', `Active schedules: ${SCHEDULED_TIMES.map(t => `${t.hour}:${t.minute}`).join(', ')}`);
}

// ============================================================
// GESTIÓN DE ESTADO Y MEMORIA OPTIMIZADA
// Limpieza automática cada hora para evitar memory leaks
// ============================================================

const chatHistory = new Map();
const processedMessages = new Set();
const cooldowns = new Map();
const userStates = new Map();

const MAX_HISTORY_LENGTH = 10;
const COOLDOWN_SECONDS = 3;

// Limpieza automática de memoria
setInterval(() => {
    const now = Date.now();
    
    // Limpia cooldowns expirados
    for (const [key, expiry] of cooldowns.entries()) {
        if (now > expiry) cooldowns.delete(key);
    }
    
    // Limpia mensajes procesados viejos (más de 10 minutos)
    if (processedMessages.size > 1000) {
        processedMessages.clear();
        CRITICAL_LOG.info('MEMORY', 'Cleared old processed messages');
    }
    
    // Limpia historiales de chat muy largos
    for (const [key, history] of chatHistory.entries()) {
        if (history.length > MAX_HISTORY_LENGTH * 3) {
            history.splice(0, history.length - MAX_HISTORY_LENGTH * 2);
        }
    }
}, 3600000); // Cada hora

// Estados del Bot
const STATE_WELCOME = -1;
const STATE_MAIN = 0;
const STATE_SUBMENU = 1;
const STATE_GEMINI_MODE = 2;
const STATE_RECADO = 30;
const STATE_CITA = 40;

// ============================================================
// VALIDACIONES Y CONSTANTES
// ============================================================

const LEON_NUMBER_REGEX = /(?:\+?52)?\s*477\s*\d{7}/;

const ERROR_INVALID_NUMBER = "⚠ *Número de Contacto Inválido u Obligatorio.*\n\nDebe incluir un número de teléfono con la LADA de León en el formato: `+52477XXXXXXX` en su mensaje. Por favor, vuelva a enviar la solicitud con el formato correcto o pulse *0* para volver.";
const ERROR_EMPTY_MESSAGE = "⚠ Su mensaje está vacío. Por favor, escriba la información solicitada o pulse *0* para cancelar y volver.";
const ERROR_INVALID_SUBMENU = "⚠ *Selección Inválida.*\n\nActualmente se encuentra dentro de un submenú. Por favor, ingrese el número *0* para volver al menú principal.";

const MENU_RETURN_PROMPT = "\n\n---\n↩ Para regresar al menú principal, responda con el número *0*.";

const SALUDO_INICIAL_IMAGEN = 
    "👋 *¡Hola! Gracias por comunicarte a Axellabottechnology*\n\n" +
    "Este es un agente digital impulsado por tecnología de punta. 🚀✨\n\n" +
    "📍 Para conocer mis funciones y ver el menú principal, solo escribe la palabra: */menu*";

const MENU_BIENVENIDA = 
    "🤖 *¡Bienvenido a Axelsolutions!*\n\n" +
    "Somos tu aliado en Soluciones Tecnológicas. 💻✨\n\n" +
    "Selecciona una opción para comenzar:\n\n" +
    "*1.* 🌐 Visitar nuestra página web\n" +
    "*2.* 💬 Hablar con Asistente Inteligente\n" +
    "*3.* 📋 Ver Menú de Servicios Completo\n" +
    "\n*✔ (Escriba solo el número de la opción: 1-3) ✔*";

const MENU_PRINCIPAL = 
    "✅ *Agente de Servicio Operativo.*\n\n" +
    "Estimado cliente, gracias por contactarnos. En breve, uno de nuestros agentes especializados le atenderá. \n\n" +
    "Si lo prefiere, seleccione una opción para agilizar su atención:\n\n" +
    "*1.* Enviar Correo Electrónico (EMAIL) 📧\n" +
    "*2.* Llamar vía WhatsApp 📞\n" +
    "*3.* Dejar un Recado / Mensaje 📝\n" +
    "*4.* Agendar una Cita o Reunión 🗓\n" +
    "*5.* Consultar sobre nuestros servicios 💡\n" +
    "*0.* 🔙 Volver al Menú de Bienvenida\n" +
    "\n*✔ (Escriba solo el número de la opción: 0-5) ✔*";

const RECADO_PROMPT_LIST = 
    "📝 *Opción 3: Dejar un Recado*\n\nPor favor, responda con los siguientes datos:\n\n" +
    "👤 *Nombre:*\n" +
    "📞 *Número de Contacto:* (+52477XXXXXXX, Obligatorio)\n" +
    "📜 *Recado/Motivo:*\n\n" +
    "Nuestros agentes lo revisarán prioritariamente. (Al finalizar, puede escribir 0 para volver al menú)";

const CITA_PROMPT_NEW = 
    `🗓 *Opción 4: Agendar Cita*\n\nPara coordinar una reunión, por favor responda con los siguientes datos:\n\n` +
    `👤 *Nombre Completo:*\n` +
    `📞 *Número de Contacto:* (+52477XXXXXXX, Obligatorio)\n` +
    `📌 *Asunto de la reunión:*\n` +
    `📅 *Fecha sugerida:*\n` +
    `⏰ *Hora sugerida:*\n\n` +
    `Un asesor confirmará la disponibilidad a la brevedad.${MENU_RETURN_PROMPT}`;

const personalityPrompt = 
    "Eres un Asistente Digital de Axelsolutions. Responde en español de forma BREVE y CONCISA (máximo 3-4 oraciones). " +
    "Sé directo, profesional y evita texto innecesario. No uses muchos emojis ni menciones que eres IA. " +
    "IMPORTANTE: Al final de cada respuesta, añade SIEMPRE esta línea exacta: " +
    "'\n\n🔕 *Escribe /salir para volver al menú principal.*'";

const WELCOME_OPTIONS = {
    1: {
        response: `🌐 *Visita nuestra página web:*\n\nhttps://compualextech24.github.io/innovaaxeltechweb/\n\nDescubre todos nuestros servicios y proyectos.\n\n↩ Pulse *0* para regresar.`,
        newState: STATE_SUBMENU
    },
    2: {
        response: `💬 *Modo Conversación Activado*\n\nAhora puede hablar directamente con nuestro asistente inteligente. Haga cualquier pregunta sobre nuestros servicios.\n\n📌 Para volver al menú inicial, escriba */salir*`,
        newState: STATE_GEMINI_MODE
    },
    3: {
        response: MENU_PRINCIPAL,
        newState: STATE_MAIN
    }
};

const MENU_OPTIONS = {
    0: {
        response: MENU_BIENVENIDA,
        newState: STATE_WELCOME
    },
    1: {
        response: `📧 *Opción 1: Enviar Correo Electrónico*\n\nPara enviarnos un correo directo, haga clic en el enlace siguiente:\n\nmailto:${CONTACT_EMAIL}?subject=Consulta%20Servicio%20WhatsApp${MENU_RETURN_PROMPT}`,
        newState: STATE_SUBMENU
    },
    2: {
        response: `📞 *Opción 2: Llamar vía WhatsApp*\n\nHaga clic en el enlace para iniciar una llamada con nuestro equipo:\n\nEnlace de Llamada: wa.me/524791449771${MENU_RETURN_PROMPT}`,
        newState: STATE_SUBMENU
    },
    3: {
        response: RECADO_PROMPT_LIST,
        newState: STATE_RECADO
    },
    4: {
        response: CITA_PROMPT_NEW,
        newState: STATE_CITA
    },
    5: {
        response: `💡 *Opción 5: Soluciones Tecnológicas*\n\nSomos líderes en innovación y desarrollo de software a medida.\n\n🌐 *Visite nuestro sitio web:*\nhttps://compualextech24.github.io/innovaaxeltechweb/\n\n*Puede escribir su duda específica ahora mismo* y nuestro sistema inteligente le brindará información preliminar.${MENU_RETURN_PROMPT}`,
        newState: STATE_SUBMENU
    }
};

// ============================================================
// SISTEMA DE RECONEXIÓN INTELIGENTE
// Backoff exponencial + límite de reintentos
// ============================================================

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 5000;

function getReconnectDelay() {
    const delay = Math.min(
        BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts),
        300000 // Máximo 5 minutos
    );
    return delay;
}

// ============================================================
// KEEP-ALIVE MEJORADO
// Ping cada 10 segundos para mantener socket activo
// ============================================================

function setupKeepAlive(sock) {
    const keepAliveInterval = setInterval(async () => {
        if (isSocketConnected) {
            try {
                await sock.query({
                    tag: 'iq',
                    attrs: {
                        to: '@s.whatsapp.net',
                        type: 'get',
                        xmlns: 'w:p',
                    },
                    content: [{ tag: 'ping' }]
                });
            } catch (error) {
                // Silencioso - solo mantiene vivo el socket
            }
        }
    }, 10000); // Cada 10 segundos

    return keepAliveInterval;
}

// ============================================================
// FUNCIÓN PRINCIPAL DE CONEXIÓN
// ============================================================

async function connectToWhatsApp() {
    try {
        console.clear();
        CRITICAL_LOG.info('STARTUP', 'Iniciando Axellabottechnology v2.0...');

        const { state, saveCreds } = await useMultiFileAuthState("auth_info");
        
        // Logger ultra-silencioso
        const logger = pino({
            level: 'silent'
        }, pino.destination('/dev/null'));
        
        const { version } = await fetchLatestBaileysVersion();
        CRITICAL_LOG.info('VERSION', `WhatsApp Web: ${version.join('.')}`);

        const sock = makeWASocket({
            version,
            auth: state,
            logger,
            printQRInTerminal: false,
            syncFullHistory: false,
            browser: ['Axellabottechnology', 'Chrome', '1.0.0'],
            getMessage: async () => undefined,
            markOnlineOnConnect: false,
            emitOwnEvents: false,
            fireInitQueries: false,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            retryRequestDelayMs: 250
        });

        let keepAliveTimer = null;

        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log("\n📱 Escanea el QR:");
                qrcode.generate(qr, { small: true });
            }

            if (connection === "open" && sock.user?.id) {
                isSocketConnected = true;
                reconnectAttempts = 0;
                
                let cleaned = sock.user.id.replace(/:[0-9]+/, "");
                if (cleaned.startsWith("521")) cleaned = cleaned.replace("521", "52");
                
                CRITICAL_LOG.success('CONNECTION', `Bot connected: ${cleaned.split("@")[0]}`);
                
                // Inicia keep-alive
                if (keepAliveTimer) clearInterval(keepAliveTimer);
                keepAliveTimer = setupKeepAlive(sock);
                
                scheduleMessages(sock);
            }

            if (connection === "close") {
                isSocketConnected = false;
                
                if (keepAliveTimer) {
                    clearInterval(keepAliveTimer);
                    keepAliveTimer = null;
                }

                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const reason = lastDisconnect?.error?.output?.payload?.error || 'Unknown';
                
                CRITICAL_LOG.warn('CONNECTION', `Closed - Reason: ${reason} (Code: ${statusCode})`);

                if (statusCode === DisconnectReason.loggedOut) {
                    CRITICAL_LOG.error('AUTH', 'Session logged out - Delete auth_info to re-authenticate');
                    return;
                }

                if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    const delay = getReconnectDelay();
                    reconnectAttempts++;
                    
                    CRITICAL_LOG.info('RECONNECT', `Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay/1000}s`);
                    
                    setTimeout(connectToWhatsApp, delay);
                } else {
                    CRITICAL_LOG.error('RECONNECT', 'Max reconnection attempts reached - Manual intervention required');
                }
            }

            if (connection === "connecting") {
                CRITICAL_LOG.info('CONNECTION', 'Connecting to WhatsApp...');
            }
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("messages.upsert", async ({ messages, type }) => {
            if (type !== "notify") return;

            const m = messages[0];
            if (!m.message || m.key.fromMe) return;

            const remoteJid = m.key.remoteJid;
            if (remoteJid.endsWith("@g.us") || remoteJid.includes("@newsletter")) return;
            if (m.message.protocolMessage || m.message.senderKeyDistributionMessage) return;

            if (processedMessages.has(m.key.id)) return;
            processedMessages.add(m.key.id);
            setTimeout(() => processedMessages.delete(m.key.id), 60000);

            lastMessageTimestamp = Date.now();

            let text = m.message.conversation ||
                       m.message.extendedTextMessage?.text ||
                       m.message.imageMessage?.caption ||
                       m.message.videoMessage?.caption || "";
            
            if (!text || text.trim().length === 0) return;

            text = text.replace(/^@\d+\s*/g, "").trim();
            
            if (cooldowns.has(remoteJid) && Date.now() < cooldowns.get(remoteJid)) return;
            
            const currentState = userStates.get(remoteJid);
            const normalized = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const remoteNumber = remoteJid.split('@')[0];

            // NUEVO USUARIO
            if (currentState === undefined) {
                userStates.set(remoteJid, STATE_WELCOME);
                
                const imagePath = './Imagenes/LogotipoEmpresa.png';
                const audioPath = './Vozsaludo.ogg';
                
                try {
                    if (fs.existsSync(imagePath)) {
                        await sock.sendMessage(remoteJid, {
                            image: fs.readFileSync(imagePath),
                            caption: SALUDO_INICIAL_IMAGEN
                        });
                    } else {
                        await sock.sendMessage(remoteJid, { text: SALUDO_INICIAL_IMAGEN });
                    }

                    if (fs.existsSync(audioPath)) {
                        await sock.sendMessage(remoteJid, {
                            audio: { url: audioPath },
                            mimetype: 'audio/ogg; codecs=opus',
                            ptt: true
                        });
                    }
                } catch (error) {
                    CRITICAL_LOG.error('MESSAGE_SEND', error);
                }
                return;
            }

            // MENÚ BIENVENIDA
            if (currentState === STATE_WELCOME) {
                const welcomeMatch = text.trim().match(/^[1-3]$/);
                if (welcomeMatch) {
                    const option = parseInt(welcomeMatch[0]);
                    const selectedOption = WELCOME_OPTIONS[option];

                    if (!selectedOption) return;

                    userStates.set(remoteJid, selectedOption.newState);
                    
                    try {
                        await sock.sendMessage(remoteJid, { text: selectedOption.response });
                        return;
                    } catch (error) {
                        CRITICAL_LOG.error('MESSAGE_SEND', error);
                        return;
                    }
                }
            }

            // OPCIONES MENÚ PRINCIPAL
            const optionMatch = text.trim().match(/^[0-5]$/);
            if (optionMatch) {
                const option = parseInt(optionMatch[0]);
                const selectedOption = MENU_OPTIONS[option];

                if ((currentState === STATE_SUBMENU || currentState === STATE_RECADO || currentState === STATE_CITA) && option !== 0) {
                    await sock.sendMessage(remoteJid, { text: ERROR_INVALID_SUBMENU });
                    return;
                }
                
                if (!selectedOption) return;

                userStates.set(remoteJid, selectedOption.newState);
                
                try {
                    await sock.sendMessage(remoteJid, { text: selectedOption.response });
                    return;
                } catch (error) {
                    CRITICAL_LOG.error('MESSAGE_SEND', error);
                    return;
                }
            }

            // COMANDO /MENU
            if (normalized === "/menú" || normalized === "/menu") {
                await sock.sendMessage(remoteJid, { text: MENU_BIENVENIDA });
                userStates.set(remoteJid, STATE_WELCOME);
                cooldowns.set(remoteJid, Date.now() + COOLDOWN_SECONDS * 1000);
                return;
            }

            // RECADO O CITA
            if (currentState === STATE_RECADO || currentState === STATE_CITA) {
                if (text.trim().length === 0) {
                    await sock.sendMessage(remoteJid, { text: ERROR_EMPTY_MESSAGE });
                    return;
                }

                const isRecado = currentState === STATE_RECADO;
                const subject = isRecado ? "📝 NUEVO RECADO de Cliente" : "🗓 NUEVA CITA / REUNIÓN Solicitada";
                
                const match = text.match(LEON_NUMBER_REGEX);
                
                if (!match) {
                    await sock.sendMessage(remoteJid, { text: ERROR_INVALID_NUMBER });
                    cooldowns.set(remoteJid, Date.now() + COOLDOWN_SECONDS * 1000);
                    return;
                }

                const clientContactNumber = match[0].trim();
                
                const body = `
==============================================
TIPO: ${isRecado ? 'RECADO / MENSAJE' : 'CITA / REUNIÓN'}
CONTACTO INICIADOR: ${remoteNumber}
WHATSAPP INICIADOR: wa.me/${remoteNumber}
CONTACTO DIRECTO (REQUERIDO): ${clientContactNumber}
==============================================

CONTENIDO DEL MENSAJE:
${text}
`;

                await sock.sendPresenceUpdate('composing', remoteJid);

                const success = await sendEmail(subject, body);
                
                let replyMessage;

                if (success) {
                    replyMessage = "✅ *Mensaje/Cita Enviado con Éxito.*\n\nUn agente lo revisará a la brevedad.\n\n" + MENU_RETURN_PROMPT;
                } else {
                    replyMessage = "❌ *Error de Sistema.*\n\nOcurrió un error al enviar su solicitud por correo. Por favor, vuelva a intentar o pulse *0* para volver al menú principal.\n\n" + MENU_RETURN_PROMPT;
                }
                
                userStates.set(remoteJid, STATE_MAIN);
                await sock.sendMessage(remoteJid, { text: replyMessage });
                
                cooldowns.set(remoteJid, Date.now() + COOLDOWN_SECONDS * 1000);
                await sock.sendPresenceUpdate('available', remoteJid);
                return;
            }

            // SUBMENU - No procesa texto libre
            if (currentState === STATE_SUBMENU) return;

            // MODO GEMINI
            if (currentState === STATE_GEMINI_MODE) {
                if (normalized === "/salir" || normalized === "/menu" || normalized === "/menú") {
                    userStates.set(remoteJid, STATE_WELCOME);
                    chatHistory.delete(remoteJid);
                    
                    await sock.sendMessage(remoteJid, {
                        text: "✅ Has salido del modo IA.\n\n" + MENU_BIENVENIDA
                    });
                    cooldowns.set(remoteJid, Date.now() + COOLDOWN_SECONDS * 1000);
                    return;
                }

                // Verifica circuit breaker
                if (!geminiCircuit.canExecute()) {
                    await sock.sendMessage(remoteJid, {
                        text: "⚠️ El asistente IA está temporalmente no disponible. Por favor, intente en unos minutos o escriba */salir* para volver al menú."
                    });
                    return;
                }

                if (!chatHistory.has(remoteJid)) chatHistory.set(remoteJid, []);
                let history = chatHistory.get(remoteJid);

                const isFactual = text.match(/\b(qué|cual|cuál|quién|dónde|cuántos|cuántas|cómo)\b/i);
                let contextPrompt = personalityPrompt;
                contextPrompt += isFactual ? " Responda con precisión técnica pero brevemente." : " Sea cortés y profesional, pero breve.";

                const conversation = [
                    { role: "user", parts: [{ text: contextPrompt }] },
                    ...history,
                    { role: "user", parts: [{ text }] },
                ];

                try {
                    await sock.sendPresenceUpdate('composing', remoteJid);
                    
                    const result = await Promise.race([
                        model.generateContent({ contents: conversation }),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Timeout')), 30000)
                        )
                    ]);

                    let reply = result.response.text();

                    await sock.sendMessage(remoteJid, { text: reply });

                    history.push({ role: "user", parts: [{ text }] });
                    history.push({ role: "model", parts: [{ text: reply }] });
                    if (history.length > MAX_HISTORY_LENGTH * 2) history.splice(0, 2);
                    
                    geminiCircuit.recordSuccess();
                    cooldowns.set(remoteJid, Date.now() + COOLDOWN_SECONDS * 1000);
                } catch (error) {
                    CRITICAL_LOG.error('GEMINI', error);
                    geminiCircuit.recordFailure();
                    
                    await sock.sendMessage(remoteJid, {
                        text: "Lo siento, tuve un problema al procesar tu mensaje. Por favor, inténtalo de nuevo o escribe */salir* para volver al menú."
                    });
                } finally {
                    await sock.sendPresenceUpdate('available', remoteJid);
                }
            }
        });

    } catch (error) {
        CRITICAL_LOG.error('CRITICAL', error);
        
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            const delay = getReconnectDelay();
            reconnectAttempts++;
            
            CRITICAL_LOG.info('RESTART', `Restarting in ${delay/1000}s...`);
            setTimeout(connectToWhatsApp, delay);
        }
    }
}

// ============================================================
// INICIO DEL BOT
// ============================================================

connectToWhatsApp().catch(err => {
    CRITICAL_LOG.error('FATAL', err);
    process.exit(1);
});
