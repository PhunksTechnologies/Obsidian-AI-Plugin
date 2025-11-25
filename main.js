const { requestUrl, Plugin, ItemView, PluginSettingTab, Setting, MarkdownRenderer } = require('obsidian');

const DEFAULT_SETTINGS = {
    provider: 'Google Gemini', // openrouter, ollama, groq, mistral, google
    apiKey: 'AIzaSyBfIt1SfcLptBhyDmG-6X6E-YIBFuxGUtc',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
    model: 'gemini-3-pro-preview',
    maxContextChars: 5000,
    taskDelayMs: 3000
};

module.exports = class ObsidianAIAgent extends Plugin {
    async onload() {
        console.log("AI Agent loaded ✅");

        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

        this.taskQueue = [];
        this.processingQueue = false;

        this.registerView('ai-agent-view', leaf => new AIAgentView(leaf, this));

        // Команда открытия панели
        this.addCommand({
            id: 'open-ai-agent',
            name: 'Open AI Agent Panel',
            callback: () => this.openPanel()
        });

        // Иконка в левом тулбаре
        this.addRibbonIcon('brain', 'Open AI Agent', () => this.openPanel());

        // Настройки
        this.addSettingTab(new AIAgentSettingTab(this.app, this));
    }

    async saveSettings() { await this.saveData(this.settings); }

    async openPanel() {
        // Берём правый leaf на одном уровне (не split)
        let leaf = this.app.workspace.getRightLeaf(false);
        await leaf.setViewState({
            type: 'ai-agent-view',
            active: true
        });
        leaf.setPinned(true);
        this.app.workspace.revealLeaf(leaf);
    }

    // async askAI(prompt) {
    //     const provider = this.settings.provider;
    //     if (!provider) throw new Error('Unknown provider');

    //     let body = {
    //         model: this.settings.model,
    //         messages: [{ role: 'user', content: prompt }]
    //     };

    //     const headers = { 'Content-Type': 'application/json' };
    //     if (this.settings.apiKey) headers['Authorization'] = `Bearer ${this.settings.apiKey}`;

    //     let retries = 3;
    //     while (retries > 0) {
    //         try {
    //             let response;
    //             if (provider === 'ollama') {
    //                 response = await fetch(`http://localhost:11434/v1/complete`, {
    //                     method: 'POST',
    //                     headers,
    //                     body: JSON.stringify({ model: this.settings.model, prompt })
    //                 });
    //             } else {
    //                 response = await fetch(this.settings.endpoint, {
    //                     method: 'POST',
    //                     headers,
    //                     body: JSON.stringify(body)
    //                 });
    //             }

    //             if (!response.ok) {
    //                 if (response.status === 429) {
    //                     console.warn("429 Too Many Requests, retrying...");
    //                     await new Promise(r => setTimeout(r, 2000));
    //                     retries--;
    //                     continue;
    //                 } else if (response.status === 413) {
    //                     return "Error: Payload too large. Context truncated.";
    //                 } else {
    //                     throw new Error(`AI HTTP Error: ${response.status}`);
    //                 }
    //             }

    //             const data = await response.json();
    //             if (provider === 'ollama') return data?.completion || '';
    //             return data?.choices?.[0]?.message?.content || '';
    //         } catch (e) {
    //             console.error("AI call error", e);
    //             return `Error: ${e.message}`;
    //         }
    //     }
    //     return "Error: too many requests, try later";
    // }    

async askAI(prompt) {
    const provider = this.settings.provider;
    if (!provider) throw new Error('Unknown provider');

    // --- Puter AI через CDN ---
    if (provider === 'puter') {
        try {
            // Загружаем скрипт Puter, если ещё не загружен
            if (!window.puter) {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'https://js.puter.com/v2/';
                    script.onload = resolve;
                    script.onerror = reject;
                    document.body.appendChild(script);
                });
            }

            // Используем Puter
            const response = await window.puter.ai.chat(prompt, {
                apiKey: this.settings.apiKey || '' // если нужен API ключ
            });

            // Проверяем ответ
            return response?.output || response?.text || '';
        } catch (e) {
            console.error("Puter AI error", e);
            return `Error: ${e.message}`;
        }
    }

    // --- Остальные провайдеры ---
    let body = {
        model: this.settings.model,
        messages: [{ role: 'user', content: prompt }]
    };

    const headers = { 'Content-Type': 'application/json' };
    if (this.settings.apiKey) headers['Authorization'] = `Bearer ${this.settings.apiKey}`;

    let retries = 3;
    while (retries > 0) {
        try {
            let response;
            if (provider === 'ollama') {
                response = await fetch(`http://localhost:11434/v1/complete`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ model: this.settings.model, prompt })
                });
            } else {
                response = await fetch(this.settings.endpoint, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body)
                });
            }

            if (!response.ok) {
                if (response.status === 429) {
                    console.warn("429 Too Many Requests, retrying...");
                    await new Promise(r => setTimeout(r, 2000));
                    retries--;
                    continue;
                } else if (response.status === 413) {
                    return "Error: Payload too large. Context truncated.";
                } else {
                    throw new Error(`AI HTTP Error: ${response.status}`);
                }
            }

            const data = await response.json();
            if (provider === 'ollama') return data?.completion || '';
            return data?.choices?.[0]?.message?.content || '';
        } catch (e) {
            console.error("AI call error", e);
            return `Error: ${e.message}`;
        }
    }
    return "Error: too many requests, try later";
}



    enqueueTask(task) {
        this.taskQueue.push(task);
        if (!this.processingQueue) this.processQueue();
    }

    async processQueue() {
        if (this.processingQueue) return;
        this.processingQueue = true;
        while (this.taskQueue.length) {
            const task = this.taskQueue.shift();
            await task();
            await new Promise(r => setTimeout(r, this.settings.taskDelayMs));
        }
        this.processingQueue = false;
    }
};

// ---------------- AI Agent View ----------------
//OLD
// class AIAgentView extends ItemView {
//     constructor(leaf, plugin) {
//         super(leaf);
//         this.plugin = plugin;
//         this.history = [];
//     }

//     getViewType() { return 'ai-agent-view'; }
//     getDisplayText() { return 'AI Agent'; }
//     getIcon() { return 'brain'; }

//     async onOpen() {
//         // this.containerEl.empty();
//         // this.containerEl.addClass('ai-agent-panel');

//         // const chatContainer = this.containerEl.createDiv({ cls: 'ai-chat-container' });
//         // const messagesEl = chatContainer.createDiv({ cls: 'ai-messages' });
//         // const inputWrapper = chatContainer.createDiv({ cls: 'ai-input-wrapper' });

//         // const inputEl = inputWrapper.createEl('textarea', { cls: 'ai-input' });
//         // const attachCheckbox = inputWrapper.createEl('input', { type: 'checkbox', cls: 'attach-note' });
//         // const attachLabel = inputWrapper.createEl('label', { text: 'Attach note text' });
//         // attachLabel.prepend(attachCheckbox);

//         // const sendBtn = inputWrapper.createEl('button', { text: 'Send', cls: 'ai-send-btn' });

//         this.containerEl.empty();
//         this.containerEl.addClass('ai-agent-panel');

//         const chatContainer = this.containerEl.createDiv({ cls: 'ai-chat-container' });
//         const messagesEl = chatContainer.createDiv({ cls: 'ai-messages' });
//         const inputWrapper = chatContainer.createDiv({ cls: 'ai-input-wrapper' });

//         const inputEl = inputWrapper.createEl('textarea', { cls: 'ai-input' });

//         // Создаем div для кнопки и чекбокса
//         const controlsDiv = inputWrapper.createDiv({ cls: 'ai-controls' });

//         // Чекбокс и лейбл
//         const attachCheckbox = controlsDiv.createEl('input', { type: 'checkbox', cls: 'attach-note' });
//         const attachLabel = controlsDiv.createEl('label', { text: 'Attach note text' });
//         attachLabel.prepend(attachCheckbox);

//         // Кнопка отправки
//         const sendBtn = controlsDiv.createEl('button', { text: 'Send', cls: 'ai-send-btn' });

//         const appendMessage = async (role, text) => {
//             const msgDiv = messagesEl.createDiv({ cls: `ai-msg ai-msg-${role}` });
//             if (role === 'ai') {
//                 await MarkdownRenderer.renderMarkdown(
//                     text,
//                     msgDiv,
//                     this.plugin.app.workspace.getActiveFile()?.path || '',
//                     this
//                 );
//             } else {
//                 msgDiv.setText(text);
//             }
//             setTimeout(() => { messagesEl.scrollTop = messagesEl.scrollHeight; }, 50);
//         };

//         const sendPrompt = async () => {
//             let prompt = inputEl.value.trim();
//             if (!prompt) return;
//             appendMessage('user', prompt);
//             inputEl.value = '';

//             let noteContext = '';
//             if (attachCheckbox.checked) {
//                 noteContext = await this.getNoteContext();
//                 if (noteContext.length > this.plugin.settings.maxContextChars) {
//                     noteContext = noteContext.slice(-this.plugin.settings.maxContextChars);
//                 }
//             }

//             const recentHistory = this.history.slice(-20)
//                 .map(m => `${m.role}: ${m.content}`)
//                 .join("\n");

//             prompt = `${recentHistory}\n${noteContext}\n${prompt}`;
//             if (prompt.length > this.plugin.settings.maxContextChars) {
//                 prompt = prompt.slice(-this.plugin.settings.maxContextChars);
//             }

//             this.history.push({ role: 'user', content: prompt });

//             const aiResponse = await this.plugin.askAI(prompt);
//             appendMessage('ai', aiResponse);
//             this.history.push({ role: 'ai', content: aiResponse });

//             //Uncheck back the checkbox
//             attachCheckbox.checked = false;
//         };

//         sendBtn.onclick = sendPrompt;
//         inputEl.addEventListener('keydown', e => {
//             if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
//                 e.preventDefault();
//                 sendPrompt();
//             }
//         });
//     }

//     async getNoteContext() {
//         // Берём активный файл из левой панели
//         const leftLeaf = this.plugin.app.workspace.getLeftLeaf(false);
//         const activeFile = leftLeaf?.view?.file || this.plugin.app.workspace.getActiveFile();
//         if (!activeFile) return '';

//         try {
//             let content = await this.plugin.app.vault.read(activeFile);
//             if (content.length > this.plugin.settings.maxContextChars) {
//                 content = content.slice(-this.plugin.settings.maxContextChars);
//             }
//             return content;
//         } catch {
//             return '';
//         }
//     }
// }

// ---------------- AI Agent View ----------------

class AIAgentView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.history = [];
    }

    getViewType() { return 'ai-agent-view'; }
    getDisplayText() { return 'AI Agent'; }
    getIcon() { return 'brain'; }

    async onOpen() {
        //Show provider and model selection
        this.containerEl.addClass('ai-agent-panel');

        this.containerEl.empty();
        this.containerEl.addClass('ai-agent-panel');

        // --- Provider / Model header ---
        const header = this.containerEl.createDiv({ cls: 'ai-header' });
        header.setText(`Provider: ${this.plugin.settings.provider} • Model: ${this.plugin.settings.model}`);

        const chatContainer = this.containerEl.createDiv({ cls: 'ai-chat-container' });
        const messagesEl = chatContainer.createDiv({ cls: 'ai-messages' });

        // --- Scroll to bottom button ---
        const scrollBtn = chatContainer.createDiv({ cls: 'scroll-bottom-btn', text: '↓' });
        scrollBtn.style.display = 'none';

        scrollBtn.onclick = () => {
            messagesEl.scrollTop = messagesEl.scrollHeight;
            scrollBtn.style.display = 'none';
        };

        const inputWrapper = chatContainer.createDiv({ cls: 'ai-input-wrapper' });

        const inputEl = inputWrapper.createEl('textarea', { cls: 'ai-input' });

        const controlsDiv = inputWrapper.createDiv({ cls: 'ai-controls' });

        const attachCheckbox = controlsDiv.createEl('input', { type: 'checkbox', cls: 'attach-note' });
        const attachLabel = controlsDiv.createEl('label', { text: 'Attach note text' });
        attachLabel.prepend(attachCheckbox);

        const sendBtn = controlsDiv.createEl('button', { text: 'Send', cls: 'ai-send-btn' });

        const appendMessage = async (role, text) => {
            const msgDiv = messagesEl.createDiv({ cls: `ai-msg ai-msg-${role}` });
            if (role === 'ai') {
                await MarkdownRenderer.renderMarkdown(
                    text,
                    msgDiv,
                    this.plugin.app.workspace.getActiveFile()?.path || '',
                    this
                );
            } else {
                msgDiv.setText(text);
            }
            setTimeout(() => { messagesEl.scrollTop = messagesEl.scrollHeight; }, 50);

            // Появление кнопки при сдвиге вверх
            const atBottomBefore =
                messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 10;

            setTimeout(() => {
                if (atBottomBefore) {
                    // если пользователь был внизу → автоскролл, кнопку НЕ показываем
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                    scrollBtn.style.display = 'none';
                } else {
                    // если был выше → НЕ скроллим, но отображаем кнопку
                    scrollBtn.style.display = 'block';
                }
            }, 50);
        };

        // WORKING
        // const sendPrompt = async () => {
        //     let prompt = inputEl.value.trim();
        //     if (!prompt) return;
        //     appendMessage('user', prompt);
        //     inputEl.value = '';

        //     // Сбрасываем чекбокс сразу
        //     const isAttachChecked = attachCheckbox.checked;
        //     attachCheckbox.checked = false;

        //     let noteContext = '';
        //     if (isAttachChecked) {
        //         noteContext = await this.getNoteContext();
        //         if (noteContext.length > this.plugin.settings.maxContextChars) {
        //             noteContext = noteContext.slice(-this.plugin.settings.maxContextChars);
        //         }
        //     }

        //     const recentHistory = this.history.slice(-20)
        //         .map(m => `${m.role}: ${m.content}`)
        //         .join("\n");

        //     prompt = `${recentHistory}\n${noteContext}\n${prompt}`;
        //     if (prompt.length > this.plugin.settings.maxContextChars) {
        //         prompt = prompt.slice(-this.plugin.settings.maxContextChars);
        //     }

        //     this.history.push({ role: 'user', content: prompt });

        //     const aiResponse = await this.plugin.askAI(prompt);
        //     appendMessage('ai', aiResponse);
        //     this.history.push({ role: 'ai', content: aiResponse });

        //     // Сохраняем историю в конец заметки
        //     await this.appendHistoryToNote({ role: 'user', content: prompt });
        //     await this.appendHistoryToNote({ role: 'ai', content: aiResponse });
        // };

        const sendPrompt = async () => {
            let userMessage = inputEl.value.trim();
            if (!userMessage) return;
            appendMessage('user', userMessage);
            inputEl.value = '';

            // Сбрасываем чекбокс
            const isAttachChecked = attachCheckbox.checked;
            attachCheckbox.checked = false;

            // Контекст заметки
            let noteContext = '';
            if (isAttachChecked) {
                noteContext = await this.getNoteContext();
                if (noteContext.length > this.plugin.settings.maxContextChars) {
                    noteContext = noteContext.slice(-this.plugin.settings.maxContextChars);
                }
            }

            // История
            const recentHistory = this.history.slice(-20)
                .map(m => `${m.role}: ${m.content}`)
                .join("\n");

            // Это идёт только в ИИ
            let prompt = `${recentHistory}\n${noteContext}\n${userMessage}`;
            if (prompt.length > this.plugin.settings.maxContextChars) {
                prompt = prompt.slice(-this.plugin.settings.maxContextChars);
            }

            // В историю сохраняем реальное сообщение пользователя
            this.history.push({ role: 'user', content: userMessage });

            // Запрос к AI
            const aiResponse = await this.plugin.askAI(prompt);

            appendMessage('ai', aiResponse);

            // В историю — реальный ответ AI
            this.history.push({ role: 'ai', content: aiResponse });

            // --- КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ ---
            // Сначала пишем пользователя
            await this.appendHistoryToNote({ role: 'user', content: userMessage });

            // Даем FS успеть записаться
            await new Promise(res => setTimeout(res, 50));

            // Потом пишем AI
            await this.appendHistoryToNote({ role: 'ai', content: aiResponse });

            // И ещё небольшой таймаут
            await new Promise(res => setTimeout(res, 50));
        };

        // --- Scroll listener ---
        messagesEl.addEventListener('scroll', () => {
            const atBottom =
                messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 10;

            // Если пользователь внизу — кнопку не показывать
            if (atBottom) {
                scrollBtn.style.display = 'none';
            } else {
                scrollBtn.style.display = 'block';
            }
        });


        sendBtn.onclick = sendPrompt;
        inputEl.addEventListener('keydown', e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                sendPrompt();
            }
        });
    }

    async getNoteContext() {
        const leftLeaf = this.plugin.app.workspace.getLeftLeaf(false);
        const activeFile = leftLeaf?.view?.file || this.plugin.app.workspace.getActiveFile();
        if (!activeFile) return '';

        try {
            let content = await this.plugin.app.vault.read(activeFile);
            if (content.length > this.plugin.settings.maxContextChars) {
                content = content.slice(-this.plugin.settings.maxContextChars);
            }
            return content;
        } catch {
            return '';
        }
    }

    // ---------------- Новая функция для добавления сообщений в конец заметки ----------------
    // async appendHistoryToNote(message) {
    //     const fileName = '##GLOBAL TASKING/AI/AI Agent History.md';
    //     const vault = this.plugin.app.vault;
    //     const textToAppend = `**${message.role}**: ${message.content}\n\n`;

    //     let file = vault.getAbstractFileByPath(fileName);

    //     if (file) {
    //         // Читаем текущий контент и добавляем в конец
    //         const currentContent = await vault.read(file);
    //         await vault.modify(file, currentContent + textToAppend);
    //     } else {
    //         // Создаём новый файл
    //         await vault.create(fileName, textToAppend);
    //     }
    // }

    async appendHistoryToNote(message) {
        const adapter = this.plugin.app.vault.adapter;

        const filePath = '##GLOBAL TASKING/AI/AI Agent History.md';

        // Настройки для форматирования
        const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const isUser = message.role === 'user';

        // Красивый формат чата
        const text =
            `---\n` +
            `**${isUser ? "👤 User" : "🤖 AI"} — ${timestamp}**\n\n` +
            `${message.content.trim()}\n\n`;

        // Создаём папки (если уже существуют — просто игнорируем)
        await adapter.mkdir('##GLOBAL TASKING').catch(() => {});
        await adapter.mkdir('##GLOBAL TASKING/AI').catch(() => {});

        // Проверяем существование файла
        const exists = await adapter.exists(filePath);

        // Если файла нет — создаём
        if (!exists) {
            await adapter.write(filePath, text);
            return;
        }

        // Если есть — дописываем
        await adapter.append(filePath, text);
    }

};


// ---------------- Settings Tab ----------------

class AIAgentSettingTab extends PluginSettingTab {
    constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "AI Agent Settings" });

        new Setting(containerEl)
            .setName("AI Provider")
            .setDesc("Choose the AI service provider")
            .addDropdown(drop => {
                drop.addOption('openai', 'Open AI');
                drop.addOption('openrouter', 'OpenRouter');
                drop.addOption('ollama', 'Ollama (local)');
                drop.addOption('groq', 'Groq Cloud');
                drop.addOption('mistral', 'Mistral API');
                drop.addOption('google', 'Google AI Studio');
                drop.addOption('google gemini', 'Google Gemini');
                drop.addOption('puter', 'Puter AI');  // ← добавили Puter
                drop.setValue(this.plugin.settings.provider);
                drop.onChange(async value => {
                    this.plugin.settings.provider = value;
                    await this.plugin.saveSettings();
                    this.display();
                });
            });


        switch (this.plugin.settings.provider) {
            case 'puter':

                new Setting(containerEl)
                    .setName("Puter API Key")
                    .addText(t => t.setValue(this.plugin.settings.apiKey)
                        .setPlaceholder("Optional API key")
                        .onChange(async v => { this.plugin.settings.apiKey = v; await this.plugin.saveSettings(); }));
            case 'openai':
            case 'openrouter':
            case 'groq':
            case 'mistral':
            case 'google gemini':
                new Setting(containerEl).setName("API Endpoint")
                    .addText(t => t.setPlaceholder("https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent")
                        .setValue(this.plugin.settings.endpoint)
                        .onChange(async v => { this.plugin.settings.endpoint = v; await this.plugin.saveSettings(); }));
                new Setting(containerEl).setName("API Key")
                    .addText(t => t.setPlaceholder("..")
                        .setValue(this.plugin.settings.apiKey)
                        .onChange(async v => { this.plugin.settings.apiKey = v; await this.plugin.saveSettings(); }));
                new Setting(containerEl).setName("Model")
                    .addText(t => t.setValue(this.plugin.settings.model)
                        .onChange(async v => { this.plugin.settings.model = v; await this.plugin.saveSettings(); }));
                break;
            case 'google':
                new Setting(containerEl).setName("API Endpoint")
                    .addText(t => t.setPlaceholder("https://example.com/api")
                        .setValue(this.plugin.settings.endpoint)
                        .onChange(async v => { this.plugin.settings.endpoint = v; await this.plugin.saveSettings(); }));
                new Setting(containerEl).setName("API Key")
                    .addText(t => t.setPlaceholder("sk-...")
                        .setValue(this.plugin.settings.apiKey)
                        .onChange(async v => { this.plugin.settings.apiKey = v; await this.plugin.saveSettings(); }));
                new Setting(containerEl).setName("Model")
                    .addText(t => t.setValue(this.plugin.settings.model)
                        .onChange(async v => { this.plugin.settings.model = v; await this.plugin.saveSettings(); }));
                break;
            case 'ollama':
                new Setting(containerEl).setName("Model Name")
                    .addText(t => t.setValue(this.plugin.settings.model)
                        .onChange(async v => { this.plugin.settings.model = v; await this.plugin.saveSettings(); }));
                break;
        }
    }
};