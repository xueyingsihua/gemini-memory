// ==UserScript==
// @name         信笺 · 初晴 | Gemini 官网免复制一键记忆库同步助手 (RAG)
// @namespace    https://github.com/chuqing-gemini-rag
// @version      1.8.1
// @description  在 gemini.google.com 官网页面挂载初晴信笺风悬浮岛：免复制一键抓取当前对话、生成 text-embedding-004 向量并归档至 GitHub 分支 JSON；支持一键检索 Top-K 记忆直接填入官网输入框！
// @author       Antigravity & 夕颜(初晴主题)
// @match        https://gemini.google.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @connect      generativelanguage.googleapis.com
// @connect      api.siliconflow.cn
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // 突破 Gemini 官网 Trusted Types 安全策略限制
    let trustedPolicy = null;
    if (window.trustedTypes && window.trustedTypes.createPolicy) {
        try {
            trustedPolicy = window.trustedTypes.createPolicy('chuqing-rag-policy', {
                createHTML: (s) => s
            });
        } catch (e) {
            if (window.trustedTypes.defaultPolicy) {
                trustedPolicy = window.trustedTypes.defaultPolicy;
            }
        }
    }

    function setSafeHTML(el, htmlStr) {
        if (trustedPolicy) {
            el.innerHTML = trustedPolicy.createHTML(htmlStr);
        } else {
            el.innerHTML = htmlStr;
        }
    }

    function escapeHtml(str = '') {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function getLocalDateStr() {
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    // 突破官网 CSP 限制的跨域请求封装
    function safeFetch(url, options = {}) {
        if (typeof GM_xmlhttpRequest === 'function') {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: options.method || 'GET',
                    url: url,
                    headers: options.headers || {},
                    data: options.body || undefined,
                    timeout: options.timeout || 30000,
                    onload: (res) => {
                        resolve({
                            ok: res.status >= 200 && res.status < 300,
                            status: res.status,
                            text: async () => res.responseText,
                            json: async () => JSON.parse(res.responseText)
                        });
                    },
                    onerror: (err) => reject(new Error(err?.error || 'Network error')),
                    ontimeout: () => reject(new Error('Request timeout'))
                });
            });
        }
        return fetch(url, options);
    }

    const STORAGE_KEY = 'chuqing_official_sync_cfg_v1';
    const DEFAULT_TAGS = ['核心设定', '日常点滴', '重要事件', '偏好习惯', '约定待办', '剧情进度', '感情升温'];
    const PRESET_MODELS = {
        gemini: {
            chat: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
            embed: ['text-embedding-004', 'gemini-embedding-001'],
            rerank: ['BAAI/bge-reranker-v2-m3']
        },
        siliconflow: {
            chat: ['Qwen/Qwen2.5-7B-Instruct', 'Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'THUDM/glm-4-9b-chat'],
            embed: ['BAAI/bge-m3', 'BAAI/bge-large-zh-v1.5', 'netease-youdao/bce-embedding-base_v1', 'Pro/BAAI/bge-m3'],
            rerank: ['BAAI/bge-reranker-v2-m3', 'netease-youdao/bce-reranker-base_v1', 'Pro/BAAI/bge-reranker-v2-m3']
        },
        openai: {
            chat: ['gpt-4o-mini', 'gpt-4o', 'deepseek-chat', 'deepseek-reasoner', 'claude-3-5-sonnet-20241022', 'gemini-2.5-flash'],
            embed: ['text-embedding-3-small', 'text-embedding-3-large', 'BAAI/bge-m3'],
            rerank: ['BAAI/bge-reranker-v2-m3', 'rerank-v3.5']
        }
    };

    const PROVIDER_DEFAULTS = {
        gemini: {
            base: 'https://generativelanguage.googleapis.com',
            chatModel: 'gemini-2.5-flash',
            embedModel: 'text-embedding-004',
            rerankModel: 'BAAI/bge-reranker-v2-m3',
            keyPlaceholder: 'Google Gemini API Key (AIzaSy...)',
            basePlaceholder: 'https://generativelanguage.googleapis.com'
        },
        siliconflow: {
            base: 'https://api.siliconflow.cn/v1',
            chatModel: 'Qwen/Qwen2.5-7B-Instruct',
            embedModel: 'BAAI/bge-m3',
            rerankModel: 'BAAI/bge-reranker-v2-m3',
            keyPlaceholder: '硅基流动 API Key (sk-...)',
            basePlaceholder: 'https://api.siliconflow.cn/v1'
        },
        openai: {
            base: 'https://api.openai.com/v1',
            chatModel: 'gpt-4o-mini',
            embedModel: 'text-embedding-3-small',
            rerankModel: 'BAAI/bge-reranker-v2-m3',
            keyPlaceholder: 'OpenAI 兼容 / 中转 API Key (sk-...)',
            basePlaceholder: 'https://api.openai.com/v1 (可填中转基址)'
        }
    };

    function normalizeProvider(p) {
        if (p === 'siliconflow' || p === 'openai' || p === 'gemini') return p;
        return 'gemini';
    }

    function createDefaultChatProfiles() {
        return {
            gemini: { key: '', base: PROVIDER_DEFAULTS.gemini.base, model: PROVIDER_DEFAULTS.gemini.chatModel },
            siliconflow: { key: '', base: PROVIDER_DEFAULTS.siliconflow.base, model: PROVIDER_DEFAULTS.siliconflow.chatModel },
            openai: { key: '', base: PROVIDER_DEFAULTS.openai.base, model: PROVIDER_DEFAULTS.openai.chatModel }
        };
    }

    function createDefaultEmbedProfiles() {
        return {
            gemini: { key: '', base: PROVIDER_DEFAULTS.gemini.base, model: PROVIDER_DEFAULTS.gemini.embedModel, rerankModel: PROVIDER_DEFAULTS.gemini.rerankModel },
            siliconflow: { key: '', base: PROVIDER_DEFAULTS.siliconflow.base, model: PROVIDER_DEFAULTS.siliconflow.embedModel, rerankModel: PROVIDER_DEFAULTS.siliconflow.rerankModel },
            openai: { key: '', base: PROVIDER_DEFAULTS.openai.base, model: PROVIDER_DEFAULTS.openai.embedModel, rerankModel: PROVIDER_DEFAULTS.openai.rerankModel }
        };
    }

    function ensureProviderProfiles(cfg) {
        const defChat = createDefaultChatProfiles();
        const savedChat = (cfg.chatProfiles && typeof cfg.chatProfiles === 'object') ? cfg.chatProfiles : {};
        cfg.chatProfiles = {
            gemini: { ...defChat.gemini, ...(savedChat.gemini || {}) },
            siliconflow: { ...defChat.siliconflow, ...(savedChat.siliconflow || {}) },
            openai: { ...defChat.openai, ...(savedChat.openai || {}) }
        };
        const activeChat = normalizeProvider(cfg.apiProvider);
        if (cfg.geminiKey && !cfg.chatProfiles[activeChat].key) {
            cfg.chatProfiles[activeChat].key = cfg.geminiKey;
            if (cfg.geminiBase) cfg.chatProfiles[activeChat].base = cfg.geminiBase;
            if (cfg.chatModel) cfg.chatProfiles[activeChat].model = cfg.chatModel;
        }

        const defEmbed = createDefaultEmbedProfiles();
        const savedEmbed = (cfg.embedProfiles && typeof cfg.embedProfiles === 'object') ? cfg.embedProfiles : {};
        cfg.embedProfiles = {
            gemini: { ...defEmbed.gemini, ...(savedEmbed.gemini || {}) },
            siliconflow: { ...defEmbed.siliconflow, ...(savedEmbed.siliconflow || {}) },
            openai: { ...defEmbed.openai, ...(savedEmbed.openai || {}) }
        };
        if (cfg.embedProvider && cfg.embedProvider !== 'same') {
            const ep = normalizeProvider(cfg.embedProvider);
            if (cfg.embedKey && !cfg.embedProfiles[ep].key) {
                cfg.embedProfiles[ep].key = cfg.embedKey;
                if (cfg.embedBase) cfg.embedProfiles[ep].base = cfg.embedBase;
                if (cfg.embedModel) cfg.embedProfiles[ep].model = cfg.embedModel;
                if (cfg.rerankModel) cfg.embedProfiles[ep].rerankModel = cfg.rerankModel;
            }
        }
    }

    const state = {
        apiProvider: 'gemini',
        geminiKey: '',
        geminiBase: 'https://generativelanguage.googleapis.com',
        chatProfiles: createDefaultChatProfiles(),
        embedProvider: 'same',
        embedKey: '',
        embedBase: 'https://api.siliconflow.cn/v1',
        embedProfiles: createDefaultEmbedProfiles(),
        chatModel: 'gemini-2.5-flash',
        embedModel: 'text-embedding-004',
        rerankEnabled: false,
        rerankModel: 'BAAI/bge-reranker-v2-m3',
        topK: 5,
        minScore: 0.38,
        fetchedModels: {},
        githubPat: '',
        githubRepo: '',
        currentBranch: 'main',
        branchList: ['main', 'daily_life', 'story_branch'],
        customTags: [...DEFAULT_TAGS],
        persona: '',
        branchPersonas: {},
        selectedTags: new Set(['日常点滴']),
        archiveMode: 'tag_only',
        panelOpen: false
    };

    function loadConfig() {
        try {
            const raw = (typeof GM_getValue === 'function' ? GM_getValue(STORAGE_KEY) : localStorage.getItem(STORAGE_KEY)) || '{}';
            const parsed = JSON.parse(raw);
            Object.assign(state, parsed);
            state.embedProvider = state.embedProvider || 'same';
            state.embedKey = state.embedKey || '';
            state.embedBase = state.embedBase || 'https://api.siliconflow.cn/v1';
            state.archiveMode = ['raw', 'tag_only', 'summarize'].includes(parsed.archiveMode) ? parsed.archiveMode : 'tag_only';
            state.branchPersonas = (parsed.branchPersonas && typeof parsed.branchPersonas === 'object' && !Array.isArray(parsed.branchPersonas))
                ? parsed.branchPersonas
                : {};
            state.selectedTags = new Set(parsed.selectedTagsArr || ['日常点滴']);
            ensureProviderProfiles(state);
        } catch (e) {
            console.warn('[初晴助手] 读取配置失败', e);
        }
    }

    function saveConfig() {
        const toSave = {
            apiProvider: state.apiProvider,
            geminiKey: state.geminiKey,
            geminiBase: state.geminiBase,
            chatProfiles: state.chatProfiles,
            embedProvider: state.embedProvider,
            embedKey: state.embedKey,
            embedBase: state.embedBase,
            embedProfiles: state.embedProfiles,
            chatModel: state.chatModel,
            embedModel: state.embedModel,
            rerankEnabled: state.rerankEnabled,
            rerankModel: state.rerankModel,
            topK: state.topK,
            minScore: state.minScore,
            archiveMode: state.archiveMode,
            fetchedModels: state.fetchedModels,
            githubPat: state.githubPat,
            githubRepo: state.githubRepo,
            currentBranch: state.currentBranch,
            branchList: state.branchList,
            customTags: state.customTags,
            persona: state.persona,
            branchPersonas: state.branchPersonas,
            selectedTagsArr: Array.from(state.selectedTags)
        };
        const str = JSON.stringify(toSave);
        if (typeof GM_setValue === 'function') {
            GM_setValue(STORAGE_KEY, str);
        }
        localStorage.setItem(STORAGE_KEY, str);
    }

    /* ========================================================================
       1. 注入「信笺 · 初晴」样式与悬浮面板、电影票打孔 Toast
       ======================================================================== */
    function injectStyles() {
        if (document.getElementById('cq-chuqing-style')) return;
        const style = document.createElement('style');
        style.id = 'cq-chuqing-style';
        style.textContent = `
            #cq-toast-wrap {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 999999;
                display: flex;
                flex-direction: column;
                gap: 10px;
                pointer-events: none;
            }
            .cq-ticket-toast {
                pointer-events: auto;
                position: relative;
                width: 320px;
                padding: 11px 14px 13px 58px;
                background: #fdfbf7;
                color: #5d4e46;
                border-radius: 6px;
                box-shadow: 3px 5px 15px rgba(0,0,0,0.12);
                font-family: 'Lato', 'Microsoft YaHei', sans-serif;
                font-size: 12.5px;
                -webkit-mask-image:
                    radial-gradient(circle at 44px 0, transparent 6px, black 6.5px),
                    radial-gradient(circle at 44px 100%, transparent 6px, black 6.5px),
                    linear-gradient(black, black);
                -webkit-mask-composite: destination-out, destination-out, source-over;
            }
            .cq-ticket-toast::before {
                content: "✦";
                position: absolute;
                left: 0; top: 0; bottom: 0;
                width: 44px;
                background: #4caf50;
                color: #fff;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 16px;
                border-right: 2px dashed rgba(255,255,255,0.5);
            }
            .cq-ticket-toast.warn::before { background: #ff9800; content: "!"; }
            .cq-ticket-toast.err::before { background: #d9534f; content: "×"; }

            /* 悬浮触发胶囊 */
            #cq-floating-pill {
                position: fixed;
                right: 22px;
                bottom: 96px;
                z-index: 999990;
                background: #fdfbf7;
                color: #5d4e46;
                border: 1.5px solid #bfaea0;
                border-left: 4px solid #8c7b70;
                border-radius: 50px;
                padding: 8px 16px;
                box-shadow: 3px 5px 15px rgba(0,0,0,0.12);
                font-family: 'Noto Serif SC', 'Microsoft YaHei', serif;
                font-size: 13.5px;
                font-weight: 700;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                user-select: none;
                transition: all 0.2s ease;
            }
            #cq-floating-pill:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 18px rgba(140, 123, 112, 0.28);
                border-color: #8c7b70;
            }

            /* 展开式初晴同步面板 */
            #cq-sync-panel {
                position: fixed;
                right: 22px;
                bottom: 146px;
                width: 370px;
                max-width: calc(100vw - 32px);
                max-height: 80vh;
                overflow-y: auto;
                z-index: 999991;
                background: #eee6de;
                border: 1px solid #bfaea0;
                border-radius: 10px;
                box-shadow: 0 12px 32px rgba(0,0,0,0.18);
                padding: 14px 16px;
                font-family: 'Lato', 'Microsoft YaHei', sans-serif;
                color: #4a3e38;
                display: none;
                flex-direction: column;
                gap: 12px;
            }
            #cq-sync-panel.open {
                display: flex;
            }
            .cq-card {
                background: #fdfbf7;
                border-radius: 6px;
                border-left: 3px solid #8c7b70;
                padding: 10px 12px;
                box-shadow: 0 2px 5px rgba(0,0,0,0.05);
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .cq-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
            }
            .cq-btn {
                height: 32px;
                padding: 0 11px;
                border-radius: 6px;
                border: 1px solid #bfaea0;
                background: #fdfbf7;
                color: #5d4e46;
                font-size: 12.5px;
                font-weight: 700;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 5px;
                transition: all 0.2s ease;
            }
            .cq-btn:hover {
                border-color: #8c7b70;
                background: #fff;
            }
            .cq-btn.primary {
                background: #8c7b70;
                color: #fff;
                border-color: #8c7b70;
            }
            .cq-btn.primary:hover {
                background: #5d4e46;
            }
            .cq-btn.bot {
                background: rgba(142, 158, 171, 0.18);
                color: #556677;
                border-color: #8e9eab;
            }
            .cq-input, .cq-select, .cq-textarea {
                width: 100%;
                background: #faf9f6;
                border: 1px solid #bfaea0;
                border-radius: 5px;
                padding: 6px 9px;
                font-size: 12.5px;
                color: #4a3e38;
                box-sizing: border-box;
            }
            .cq-tag-list {
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
            }
            .cq-tag {
                font-size: 11.5px;
                padding: 2px 8px;
                border-radius: 50px;
                background: rgba(140,123,112,0.1);
                border: 1px solid rgba(140,123,112,0.3);
                color: #5d4e46;
                cursor: pointer;
                user-select: none;
            }
            .cq-tag.active {
                background: rgba(140,123,112,0.25);
                border-color: #5d4e46;
                font-weight: 700;
            }
            .cq-tag.active::before {
                content: "𝔖 ";
            }
            @media (max-width: 600px) {
                #cq-sync-panel {
                    left: 12px;
                    right: 12px;
                    width: auto;
                    bottom: 80px;
                    max-height: 75dvh;
                }
                #cq-floating-pill {
                    right: 12px;
                    bottom: 72px;
                    padding: 6px 12px;
                    font-size: 12.5px;
                }
                #cq-toast-wrap {
                    left: 50%;
                    right: auto;
                    transform: translateX(-50%);
                }
                .cq-ticket-toast {
                    width: calc(100vw - 32px);
                    max-width: 320px;
                    box-sizing: border-box;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function showToast(title, msg = '', type = 'ok') {
        let wrap = document.getElementById('cq-toast-wrap');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = 'cq-toast-wrap';
            document.body.appendChild(wrap);
        }
        const el = document.createElement('div');
        el.className = `cq-ticket-toast ${type}`;
        setSafeHTML(el, `<div style="font-weight:700;margin-bottom:2px;">${escapeHtml(title)}</div><div style="opacity:0.85;">${escapeHtml(msg)}</div>`);
        wrap.appendChild(el);
        setTimeout(() => el.remove(), 3500);
    }

    /* ========================================================================
       2. 抓取 gemini.google.com 官网当前对话 DOM 与输入框注入
       ======================================================================== */
    function scrapeOfficialGeminiChat(maxTurns = 6) {
        // 兼容 Gemini 官网多种 DOM 节点结构
        const selectors = [
            'user-query, model-response',
            '[data-message-author-role]',
            '.conversation-container .query-text, .conversation-container .model-response-text',
            'message-content'
        ];

        let nodes = [];
        for (const sel of selectors) {
            const found = Array.from(document.querySelectorAll(sel));
            if (found.length > 0) {
                nodes = found;
                break;
            }
        }

        if (nodes.length === 0) {
            // 兜底：抓取 main 区域内可见文本段落
            const mainEl = document.querySelector('main') || document.body;
            const rawText = (mainEl.innerText || '').trim();
            return rawText.slice(-2500);
        }

        const recentNodes = nodes.slice(-maxTurns * 2);
        const lines = recentNodes.map(n => {
            const tag = n.tagName.toLowerCase();
            const isUser = tag.includes('user') || n.getAttribute('data-message-author-role') === 'user' || n.classList.contains('query-text');
            const roleLabel = isUser ? '我' : 'Gemini';
            const text = (n.innerText || '').trim();
            return text ? `${roleLabel}: ${text}` : '';
        }).filter(Boolean);

        return lines.join('\n\n');
    }

    // 将文本直接填入 gemini.google.com 官网的富文本输入框
    function fillOfficialGeminiInput(textToInsert) {
        const editorSelectors = [
            '.ql-editor[contenteditable="true"]',
            'rich-textarea [contenteditable="true"]',
            'div[contenteditable="true"][role="textbox"]',
            'textarea'
        ];
        for (const sel of editorSelectors) {
            const el = document.querySelector(sel);
            if (el) {
                el.focus();
                if (el.tagName.toLowerCase() === 'textarea') {
                    const prev = el.value ? el.value + '\n\n' : '';
                    el.value = textToInsert + '\n\n' + prev;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                } else {
                    const existing = (el.innerText || '').trim();
                    const combined = existing ? `${textToInsert}\n\n${existing}` : textToInsert;
                    el.innerText = combined;
                    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: combined }));
                }
                return true;
            }
        }
        return false;
    }

    function getOfficialInputDraft() {
        const el = document.querySelector('.ql-editor[contenteditable="true"], rich-textarea [contenteditable="true"], div[contenteditable="true"][role="textbox"], textarea');
        if (!el) return '';
        return (el.value || el.innerText || '').trim();
    }

    /* ========================================================================
       3. 向量计算 (text-embedding-004) 与 GitHub API 同步
       ======================================================================== */
    function utf8ToBase64(str) {
        return btoa(unescape(encodeURIComponent(str)));
    }
    function base64ToUtf8(b64) {
        return decodeURIComponent(escape(atob(b64.replace(/\s/g, ''))));
    }
    function compactVector(vec) {
        return (vec || []).map(v => Math.round(Number(v) * 10000) / 10000);
    }
    function computeLocalFallbackVector(text) {
        const dim = 128;
        const vec = new Array(dim).fill(0);
        const clean = (text || '').toLowerCase();
        for (let i = 0; i < clean.length; i++) {
            const c1 = clean.charCodeAt(i);
            const c2 = i + 1 < clean.length ? clean.charCodeAt(i + 1) : 0;
            vec[c1 % dim] += 1;
            vec[(c1 * 31 + c2) % dim] += 0.7;
        }
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
        return compactVector(vec.map(v => v / norm));
    }

    function normalizeOpenAIBase(rawBase, fallbackBase) {
        let base = (rawBase || '').trim().replace(/\/+$/, '');
        base = base.replace(/\/(chat\/completions|embeddings|rerank|models)$/i, '').replace(/\/+$/, '');
        if (!base || base.toLowerCase().includes('generativelanguage.googleapis.com')) {
            return fallbackBase;
        }
        if (/\/v\d+[a-z0-9_-]*$/i.test(base)) {
            return base;
        }
        return `${base}/v1`;
    }

    function resolveApiEndpoint(provider, rawKey, rawBase) {
        const prov = normalizeProvider(provider);
        const key = (rawKey || '').trim();
        const cleanBase = (rawBase || '').trim().replace(/\/+$/, '');
        if (prov === 'siliconflow') {
            return {
                provider: 'siliconflow',
                useOpenAI: true,
                key,
                base: normalizeOpenAIBase(cleanBase, 'https://api.siliconflow.cn/v1')
            };
        }
        if (prov === 'openai') {
            return {
                provider: 'openai',
                useOpenAI: true,
                key,
                base: normalizeOpenAIBase(cleanBase, 'https://api.openai.com/v1')
            };
        }
        return {
            provider: 'gemini',
            useOpenAI: false,
            key,
            base: (!cleanBase || /siliconflow\.cn|api\.openai\.com/i.test(cleanBase))
                ? 'https://generativelanguage.googleapis.com'
                : cleanBase.replace(/\/v1$/i, '')
        };
    }

    function getChatApiConfig() {
        return resolveApiEndpoint(state.apiProvider || 'gemini', state.geminiKey, state.geminiBase);
    }

    function getEmbedApiConfig() {
        const ep = state.embedProvider || 'same';
        if (ep === 'same') return getChatApiConfig();
        return resolveApiEndpoint(ep, state.embedKey, state.embedBase);
    }

    async function getEmbeddingVector(text) {
        const cfg = getEmbedApiConfig();
        const key = cfg.key;
        if (!key) return computeLocalFallbackVector(text);

        if (cfg.useOpenAI) {
            const rawModel = (state.embedModel || '').trim();
            const embedModel = cfg.provider === 'siliconflow'
                ? ((!rawModel || rawModel.includes('text-embedding') || rawModel.includes('gemini-embedding')) ? 'BAAI/bge-m3' : rawModel)
                : (rawModel || 'text-embedding-3-small');
            try {
                const bodyPayload = { model: embedModel, input: text };
                if (cfg.provider === 'siliconflow') bodyPayload.encoding_format = 'float';
                const res = await safeFetch(`${cfg.base}/embeddings`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${key}`
                    },
                    body: JSON.stringify(bodyPayload)
                });
                if (res.ok) {
                    const data = await res.json();
                    const emb = data.data?.[0]?.embedding;
                    if (Array.isArray(emb)) return compactVector(emb);
                }
            } catch (e) {}
            return computeLocalFallbackVector(text);
        }

        const models = [state.embedModel || 'text-embedding-004', 'gemini-embedding-001'];
        for (const m of models) {
            try {
                const res = await safeFetch(`${cfg.base}/v1beta/models/${m}:embedContent?key=${encodeURIComponent(key)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: `models/${m}`, content: { parts: [{ text }] } })
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.embedding?.values) return compactVector(data.embedding.values);
                }
            } catch (e) {}
        }
        return computeLocalFallbackVector(text);
    }

    function cosineSimilarity(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
        let dot = 0, na = 0, nb = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            na += a[i] * a[i];
            nb += b[i] * b[i];
        }
        return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
    }

    function lexicalOverlapScore(query, slice) {
        const q = (query || '').trim().toLowerCase();
        if (!q) return 0;
        const target = `${slice.text || ''} ${(slice.tags || []).join(' ')} ${slice.event || ''}`.toLowerCase();
        let hits = 0;
        for (const ch of q) {
            if (ch.trim() && target.includes(ch)) hits++;
        }
        return (hits / Math.max(q.length, 1)) * 0.25;
    }

    async function rerankCandidates(queryText, coarseItems, topK, threshold) {
        const cfg = getEmbedApiConfig();
        const key = cfg.key;
        if (!key || !cfg.useOpenAI || coarseItems.length <= 1) return null;
        const model = (state.rerankModel || '').trim() || 'BAAI/bge-reranker-v2-m3';
        try {
            const docs = coarseItems.map(c => {
                const tagsStr = (c.slice.tags || []).map(t => `#${t}`).join(' ');
                return `${c.slice.date ? '[' + c.slice.date + '] ' : ''}${tagsStr ? tagsStr + ' ' : ''}${c.slice.text || ''}`;
            });
            const res = await safeFetch(`${cfg.base}/rerank`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`
                },
                body: JSON.stringify({
                    model,
                    query: queryText,
                    documents: docs,
                    top_n: docs.length,
                    return_documents: false
                })
            });
            if (!res.ok) return null;
            const data = await res.json();
            if (!Array.isArray(data.results) || data.results.length === 0) return null;
            const finalItems = data.results
                .map(r => {
                    const orig = coarseItems[r.index];
                    if (!orig) return null;
                    const rScore = Number(r.relevance_score || 0);
                    const fused = (rScore * 0.7) + (orig.score * 0.3) + (orig.exactBonus > 0 ? 0.25 : 0);
                    const finalScore = Math.min(0.99, Math.max(orig.score, fused));
                    return { slice: orig.slice, score: finalScore };
                })
                .filter(item => item && (threshold <= 0 || item.score >= threshold))
                .sort((a, b) => b.score - a.score)
                .slice(0, topK);

            return finalItems.length > 0 ? finalItems : null;
        } catch (e) {
            return null;
        }
    }

    async function githubListBranchFiles() {
        if (!state.githubPat || !state.githubRepo) return [];
        try {
            const res = await safeFetch(`https://api.github.com/repos/${state.githubRepo.trim()}/contents/branches?t=${Date.now()}`, {
                headers: {
                    'Authorization': `Bearer ${state.githubPat.trim()}`,
                    'Accept': 'application/vnd.github+json'
                }
            });
            if (!res.ok) return [];
            const items = await res.json();
            if (!Array.isArray(items)) return [];
            return items
                .filter(item => item.type === 'file' && typeof item.name === 'string' && item.name.endsWith('.json'))
                .map(item => item.name.slice(0, -5));
        } catch (e) {
            return [];
        }
    }

    function encodeGithubPath(path) {
        return path.split('/').map(seg => encodeURIComponent(seg)).join('/');
    }

    async function githubReadBlobFallback(path, knownSha = null) {
        const repo = state.githubRepo.trim();
        const pat = state.githubPat.trim();
        let sha = knownSha;
        if (!sha) {
            const parts = path.split('/');
            const fileName = parts.pop();
            const dirPath = parts.join('/');
            const dirUrl = dirPath
                ? `https://api.github.com/repos/${repo}/contents/${encodeGithubPath(dirPath)}?t=${Date.now()}`
                : `https://api.github.com/repos/${repo}/contents?t=${Date.now()}`;
            const dirRes = await safeFetch(dirUrl, {
                headers: { 'Authorization': `Bearer ${pat}`, 'Accept': 'application/vnd.github+json' }
            });
            if (!dirRes.ok) throw new Error(`GitHub 目录定位失败 (${dirRes.status})`);
            const items = await dirRes.json();
            const match = Array.isArray(items) && items.find(i => i.path === path || i.name === fileName);
            if (!match || !match.sha) return null;
            sha = match.sha;
        }
        const blobRes = await safeFetch(`https://api.github.com/repos/${repo}/git/blobs/${sha}`, {
            headers: { 'Authorization': `Bearer ${pat}`, 'Accept': 'application/vnd.github+json' }
        });
        if (!blobRes.ok) throw new Error(`GitHub Blob 读取失败 (${blobRes.status})`);
        const blobData = await blobRes.json();
        return {
            json: JSON.parse(base64ToUtf8(blobData.content || '')),
            sha: blobData.sha || sha
        };
    }

    async function githubGetFile(path) {
        const res = await safeFetch(`https://api.github.com/repos/${state.githubRepo.trim()}/contents/${encodeGithubPath(path)}?t=${Date.now()}`, {
            headers: {
                'Authorization': `Bearer ${state.githubPat.trim()}`,
                'Accept': 'application/vnd.github+json'
            }
        });
        if (res.status === 404) return null;
        if (res.status === 403) {
            const errText = await res.text();
            if (errText.includes('too_large')) {
                return await githubReadBlobFallback(path, null);
            }
            throw new Error(`GitHub HTTP ${res.status}`);
        }
        if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
        const data = await res.json();
        if (!data.content || data.encoding === 'none') {
            return await githubReadBlobFallback(path, data.sha || null);
        }
        return { json: JSON.parse(base64ToUtf8(data.content)), sha: data.sha };
    }

    async function githubPutFile(path, jsonData, sha = null, message = 'Sync from Gemini official web') {
        let latestSha = sha;
        if (!latestSha) {
            const existing = await githubGetFile(path).catch(() => null);
            if (existing?.sha) latestSha = existing.sha;
        }
        const body = { message, content: utf8ToBase64(JSON.stringify(jsonData)) };
        if (latestSha) body.sha = latestSha;
        const res = await safeFetch(`https://api.github.com/repos/${state.githubRepo.trim()}/contents/${encodeGithubPath(path)}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${state.githubPat.trim()}`,
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(`GitHub 写入失败 (${res.status})`);
        return await res.json();
    }

    async function callUserscriptChatPrompt(sysPrompt, rawText) {
        const cfg = getChatApiConfig();
        const key = cfg.key;
        if (!key) return null;

        if (cfg.useOpenAI) {
            const rawModel = (state.chatModel || '').trim();
            const model = cfg.provider === 'siliconflow'
                ? ((!rawModel || rawModel.startsWith('gemini-')) ? 'Qwen/Qwen2.5-7B-Instruct' : rawModel)
                : (rawModel || 'gpt-4o-mini');
            const res = await safeFetch(`${cfg.base}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: sysPrompt },
                        { role: 'user', content: rawText }
                    ]
                })
            });
            if (!res.ok) return null;
            const data = await res.json();
            return (data.choices?.[0]?.message?.content || '').trim();
        }

        const model = state.chatModel || 'gemini-2.5-flash';
        const res = await safeFetch(`${cfg.base}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: sysPrompt }] },
                contents: [{ role: 'user', parts: [{ text: rawText }] }],
                safetySettings: [
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
                ]
            })
        });
        if (!res.ok) return null;
        const data = await res.json();
        return (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    }

    function extractUserscriptJson(reply) {
        const cleaned = String(reply || '').replace(/```json|```/gi, '').trim();
        try {
            return JSON.parse(cleaned);
        } catch (e) {
            const m = cleaned.match(/\{[\s\S]*\}/);
            if (m) return JSON.parse(m[0]);
            throw e;
        }
    }

    async function summarizeViaGemini(rawText) {
        const sys = `请将以下对话提炼为 100~180 字的精简长期记忆总结，并从 [${state.customTags.join('、')}] 中选 2~3 个标签。只输出 JSON: {"text":"总结内容","tags":["标签1"]}`;
        const reply = await callUserscriptChatPrompt(sys, rawText);
        if (reply === null) return { text: rawText.slice(0, 220), tags: Array.from(state.selectedTags) };
        try {
            return extractUserscriptJson(reply);
        } catch (e) {
            return { text: reply.replace(/```json|```/gi, '').trim() || rawText.slice(0, 220), tags: Array.from(state.selectedTags) };
        }
    }

    async function tagOnlyViaGemini(rawText) {
        const sys = `请阅读用户提供的原文，绝对不要改写、总结或删减原文内容，只需挑选 2~4 个最贴合的分类标签并归纳 1 个简短事件类型。请优先参考并复用现有标签池 [${state.customTags.join('、')}]；如果现有标签不足以概括关键主题或专有概念，请自主判断并额外补充 1~2 个简短准确的新标签（2~6字为宜，不要带 # 号）。严格只输出 JSON: {"tags":["标签1","标签2"],"eventType":"日常/节日/约定/重要事件"}`;
        const reply = await callUserscriptChatPrompt(sys, rawText);
        if (reply === null) return { tags: [], eventType: '' };
        try {
            const parsed = extractUserscriptJson(reply);
            const cleanTags = Array.isArray(parsed.tags)
                ? Array.from(new Set(parsed.tags.map(t => String(t).trim().replace(/^#+/, '').trim()).filter(Boolean)))
                : [];
            return { tags: cleanTags, eventType: String(parsed.eventType || parsed.event || '').trim() };
        } catch (e) {
            return { tags: [], eventType: '' };
        }
    }

    /* ========================================================================
       4. 构建悬浮岛 UI 与交互事件
       ======================================================================== */
    function createUI() {
        if (!document.body || document.getElementById('cq-floating-pill')) return;
        loadConfig();
        injectStyles();

        const pill = document.createElement('div');
        pill.id = 'cq-floating-pill';
        setSafeHTML(pill, `<span>✉️ 初晴记忆库</span><span id="cq-pill-branch" style="font-size:11px;opacity:0.75;">[${escapeHtml(state.currentBranch)}]</span>`);
        document.body.appendChild(pill);

        const panel = document.createElement('div');
        panel.id = 'cq-sync-panel';
        setSafeHTML(panel, `
            <div class="cq-row" style="border-bottom:1px solid #bfaea0;padding-bottom:8px;">
                <strong style="font-size:14.5px;">✉️ 初晴 · 官网免复制记忆助手</strong>
                <button class="cq-btn" id="cq-btn-close" style="height:24px;padding:0 8px;">收起</button>
            </div>

            <!-- 分支切换 -->
            <div class="cq-card">
                <div class="cq-row">
                    <span style="font-size:12px;font-weight:700;">🌿 当前记忆分支 (物理隔离):</span>
                    <button class="cq-btn" id="cq-btn-sync-profile" style="height:24px;font-size:11px;">↻ 同步分支与标签</button>
                </div>
                <select id="cq-branch-select" class="cq-select"></select>
            </div>

            <!-- 一键免复制抓取入库 -->
            <div class="cq-card">
                <div class="cq-row">
                    <span style="font-size:12px;font-weight:700;">📥 免复制抓取当前页面对话入库</span>
                    <button class="cq-btn" id="cq-btn-scrape-preview" style="height:24px;font-size:11px;">🔍 抓取最新对话</button>
                </div>
                <textarea id="cq-archive-preview" class="cq-textarea" rows="3" placeholder="点「⚡ 一键抓对话入库」会自动读取当前网页上的最新对话（也可在此手动微调）..."></textarea>
                <div class="cq-tag-list" id="cq-tag-container"></div>
                <div class="cq-row" style="margin-top:4px;gap:6px;">
                    <select id="cq-ai-mode" class="cq-select" style="flex:1;min-width:0;font-size:11px;padding:4px 6px;" title="选择归档前 AI 处理方式">
                        <option value="tag_only">🏷️ 仅AI打标签/补事件 (保留原文)</option>
                        <option value="summarize">✨ AI提炼100字摘要并补标签</option>
                        <option value="raw">📝 原样入库 (不调AI)</option>
                    </select>
                    <button class="cq-btn primary" id="cq-btn-oneclick-archive" style="flex-shrink:0;">⚡ 抓对话归档</button>
                </div>
            </div>

            <!-- 一键唤醒记忆填入官网输入框 -->
            <div class="cq-card" style="border-left-color:#8e9eab;">
                <div class="cq-row">
                    <span style="font-size:12px;font-weight:700;color:#556677;">🔮 向量唤醒记忆并填入官网输入框</span>
                </div>
                <div class="cq-row">
                    <input type="text" id="cq-recall-input" class="cq-input" placeholder="留空则直接根据下方官网输入框草稿检索...">
                    <button class="cq-btn bot" id="cq-btn-recall-inject" style="flex-shrink:0;">🔮 唤醒并填入</button>
                </div>
                <div class="cq-row" style="font-size:11.5px;color:#556677;margin-top:2px;">
                    <label style="display:inline-flex;align-items:center;gap:4px;">
                        <span>最多召回:</span>
                        <input type="number" id="cq-recall-topk" class="cq-input" min="1" max="20" style="width:54px;padding:2px 6px;height:24px;font-size:11.5px;">
                        <span>条</span>
                    </label>
                    <label style="display:inline-flex;align-items:center;gap:4px;">
                        <span>最低相关度:</span>
                        <input type="number" id="cq-recall-minscore" class="cq-input" min="0" max="0.95" step="0.02" style="width:62px;padding:2px 6px;height:24px;font-size:11.5px;" title="过滤掉低于该分数的无关记忆，默认 0.38">
                    </label>
                </div>
            </div>

            <!-- 折叠配置区 -->
            <details style="font-size:12px;background:#fdfbf7;padding:8px 10px;border-radius:6px;border:1px dashed #bfaea0;">
                <summary style="cursor:pointer;font-weight:700;color:#5d4e46;">⚙️ 配置 GitHub 仓库与多路模型 Key</summary>
                <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">
                    <span style="font-size:11px;color:#5d4e46;font-weight:700;">💬 总结接口 (Chat)：</span>
                    <div class="cq-row">
                        <select id="cq-cfg-provider" class="cq-select" style="flex:1;min-width:0;">
                            <option value="gemini">✨ Google Gemini</option>
                            <option value="siliconflow">🚀 硅基流动 SiliconFlow</option>
                            <option value="openai">🌐 OpenAI 兼容 (通用中转)</option>
                        </select>
                        <button type="button" class="cq-btn" id="cq-btn-fetch-models" style="flex-shrink:0;font-size:11px;padding:4px 7px;">🔄 拉取</button>
                        <button type="button" class="cq-btn" id="cq-btn-test-chat" style="flex-shrink:0;font-size:11px;padding:4px 7px;">🧪 测试</button>
                    </div>
                    <div class="cq-row" style="gap:4px;">
                        <input type="password" id="cq-cfg-key" class="cq-input" style="flex:1;" placeholder="总结 API Key (AIzaSy... 或 sk-...)">
                        <button type="button" class="cq-btn cq-btn-toggle-secret" data-target="cq-cfg-key" title="显示/隐藏密钥" style="padding:4px 7px;flex-shrink:0;">👁️</button>
                    </div>
                    <input type="text" id="cq-cfg-base" class="cq-input" placeholder="总结接口 Base URL (可选反代/中转基址)">
                    <div style="display:flex;flex-direction:column;gap:3px;">
                        <span style="font-size:11px;color:#5d4e46;font-weight:700;">总结模型:</span>
                        <select id="cq-cfg-chat-model" class="cq-select"></select>
                    </div>
                    <hr style="border:none;border-top:1px dashed #d6cbc1;margin:2px 0;">
                    <span style="font-size:11px;color:#5d4e46;font-weight:700;">🧬 向量与重排接口 (Embedding / Rerank)：</span>
                    <div class="cq-row">
                        <select id="cq-cfg-embed-provider" class="cq-select" style="flex:1;min-width:0;">
                            <option value="same">🔗 与总结同一接口</option>
                            <option value="siliconflow">🚀 单独用 硅基流动</option>
                            <option value="gemini">✨ 单独用 Gemini</option>
                            <option value="openai">🌐 单独用 OpenAI 兼容</option>
                        </select>
                        <button type="button" class="cq-btn" id="cq-btn-fetch-embed-models" style="flex-shrink:0;font-size:11px;padding:4px 7px;">🔄 拉取</button>
                        <button type="button" class="cq-btn" id="cq-btn-test-embed" style="flex-shrink:0;font-size:11px;padding:4px 7px;">🧪 测试</button>
                    </div>
                    <div id="cq-cfg-embed-auth-box" style="display:none;flex-direction:column;gap:5px;">
                        <div class="cq-row" style="gap:4px;">
                            <input type="password" id="cq-cfg-embed-key" class="cq-input" style="flex:1;" placeholder="向量/重排独立 API Key">
                            <button type="button" class="cq-btn cq-btn-toggle-secret" data-target="cq-cfg-embed-key" title="显示/隐藏密钥" style="padding:4px 7px;flex-shrink:0;">👁️</button>
                        </div>
                        <input type="text" id="cq-cfg-embed-base" class="cq-input" placeholder="向量/重排 Base URL">
                    </div>
                    <div style="display:flex;flex-direction:column;gap:3px;">
                        <span style="font-size:11px;color:#5d4e46;font-weight:700;">向量模型:</span>
                        <select id="cq-cfg-embed-model" class="cq-select"></select>
                    </div>
                    <label style="font-size:11.5px;display:flex;align-items:center;gap:5px;cursor:pointer;color:#5d4e46;margin-top:2px;">
                        <input type="checkbox" id="cq-cfg-rerank-enabled">
                        <span>开启 Rerank 二次精排 (硅基流动/OpenAI 接口有效)</span>
                    </label>
                    <div style="display:flex;flex-direction:column;gap:3px;">
                        <span style="font-size:11px;color:#5d4e46;font-weight:700;">重排模型 (Rerank):</span>
                        <select id="cq-cfg-rerank-model" class="cq-select"></select>
                    </div>
                    <hr style="border:none;border-top:1px dashed #d6cbc1;margin:2px 0;">
                    <div class="cq-row" style="gap:4px;">
                        <input type="password" id="cq-cfg-pat" class="cq-input" style="flex:1;" placeholder="GitHub Token (ghp_...)">
                        <button type="button" class="cq-btn cq-btn-toggle-secret" data-target="cq-cfg-pat" title="显示/隐藏 Token" style="padding:4px 7px;flex-shrink:0;">👁️</button>
                    </div>
                    <input type="text" id="cq-cfg-repo" class="cq-input" placeholder="GitHub 仓库 (如 yourname/gemini-memory)">
                    <button class="cq-btn primary" id="cq-btn-save-cfg">💾 保存连接配置</button>
                </div>
            </details>
        `);
        document.body.appendChild(panel);

        let uiActiveChatProv = normalizeProvider(state.apiProvider);
        let uiActiveEmbedProv = state.embedProvider || 'same';

        function fillSelectOptions(sel, list, preferred) {
            const cleanPref = (preferred && preferred !== '__custom__') ? preferred : '';
            const finalList = Array.from(new Set(list.filter(Boolean)));
            if (cleanPref && !finalList.includes(cleanPref)) finalList.unshift(cleanPref);
            setSafeHTML(sel, '');
            finalList.forEach(m => {
                const o = document.createElement('option');
                o.value = m;
                o.textContent = m;
                sel.appendChild(o);
            });
            const customOpt = document.createElement('option');
            customOpt.value = '__custom__';
            customOpt.textContent = '✏️ 手动输入模型名...';
            sel.appendChild(customOpt);
            const targetVal = (cleanPref && finalList.includes(cleanPref)) ? cleanPref : (finalList[0] || '');
            sel.value = targetVal;
            sel.dataset.prevValue = targetVal;
        }

        function getUserscriptSelectValue(id, fallbackVal) {
            const el = document.getElementById(id);
            const v = (el?.value || '').trim();
            if (!v || v === '__custom__') return (el?.dataset?.prevValue || fallbackVal || '').trim();
            return v;
        }

        function bindUserscriptCustomSelect(selectId, labelText) {
            const selEl = document.getElementById(selectId);
            if (!selEl || selEl.dataset.customBound) return;
            selEl.dataset.customBound = '1';
            selEl.addEventListener('change', () => {
                if (selEl.value === '__custom__') {
                    const raw = prompt(`请输入自定义${labelText}名称（如 gpt-4o-mini / gemini-2.5-pro / text-embedding-3-small）：`, selEl.dataset.prevValue || '');
                    const customVal = (raw || '').trim();
                    if (!customVal || customVal === '__custom__') {
                        selEl.value = selEl.dataset.prevValue || '';
                        return;
                    }
                    const existing = Array.from(selEl.options).find(o => o.value === customVal);
                    if (!existing) {
                        const o = document.createElement('option');
                        o.value = customVal;
                        o.textContent = customVal;
                        const customPlaceholderOpt = Array.from(selEl.options).find(op => op.value === '__custom__');
                        selEl.insertBefore(o, customPlaceholderOpt || null);
                    }
                    selEl.value = customVal;
                    selEl.dataset.prevValue = customVal;
                } else {
                    selEl.dataset.prevValue = selEl.value;
                }
            });
        }

        bindUserscriptCustomSelect('cq-cfg-chat-model', '总结模型');
        bindUserscriptCustomSelect('cq-cfg-embed-model', '向量模型');
        bindUserscriptCustomSelect('cq-cfg-rerank-model', '重排模型');

        function getEffectiveEmbedProviderKey() {
            const ep = document.getElementById('cq-cfg-embed-provider').value || 'same';
            const chatP = normalizeProvider(document.getElementById('cq-cfg-provider').value);
            return ep === 'same' ? chatP : normalizeProvider(ep);
        }

        function populateChatModels(provider, customChat = null, selChat = '') {
            const pKey = normalizeProvider(provider);
            const cached = (state.fetchedModels && state.fetchedModels[pKey]) || {};
            const presets = PRESET_MODELS[pKey];
            const chatList = customChat || cached.chat || presets.chat;
            fillSelectOptions(document.getElementById('cq-cfg-chat-model'), chatList, selChat);
        }

        function populateEmbedRerankModels(provider, customEmbed = null, selEmbed = '', customRerank = null, selRerank = '') {
            const pKey = normalizeProvider(provider);
            const cached = (state.fetchedModels && state.fetchedModels[pKey]) || {};
            const presets = PRESET_MODELS[pKey];
            const embedList = customEmbed || cached.embed || presets.embed;
            const rerankList = customRerank || cached.rerank || presets.rerank || PRESET_MODELS.siliconflow.rerank;
            fillSelectOptions(document.getElementById('cq-cfg-embed-model'), embedList, selEmbed);
            fillSelectOptions(document.getElementById('cq-cfg-rerank-model'), rerankList, selRerank);
        }

        function toggleUserscriptEmbedBox() {
            const ep = document.getElementById('cq-cfg-embed-provider').value || 'same';
            const box = document.getElementById('cq-cfg-embed-auth-box');
            box.style.display = ep === 'same' ? 'none' : 'flex';
        }

        function saveUserscriptChatFormToProfile(prov) {
            const p = normalizeProvider(prov);
            const def = PROVIDER_DEFAULTS[p];
            state.chatProfiles = state.chatProfiles || createDefaultChatProfiles();
            state.chatProfiles[p] = {
                key: document.getElementById('cq-cfg-key').value.trim(),
                base: document.getElementById('cq-cfg-base').value.trim() || def.base,
                model: getUserscriptSelectValue('cq-cfg-chat-model', def.chatModel)
            };
        }

        function loadUserscriptChatProfileToForm(prov) {
            const p = normalizeProvider(prov);
            const def = PROVIDER_DEFAULTS[p];
            ensureProviderProfiles(state);
            const prof = state.chatProfiles[p] || { key: '', base: def.base, model: def.chatModel };
            const keyEl = document.getElementById('cq-cfg-key');
            const baseEl = document.getElementById('cq-cfg-base');
            keyEl.value = prof.key || '';
            keyEl.placeholder = def.keyPlaceholder;
            baseEl.value = prof.base || def.base;
            baseEl.placeholder = def.basePlaceholder;
            populateChatModels(p, null, prof.model || def.chatModel);
        }

        function saveUserscriptEmbedFormToProfile(ep) {
            if (!ep || ep === 'same') return;
            const p = normalizeProvider(ep);
            const def = PROVIDER_DEFAULTS[p];
            state.embedProfiles = state.embedProfiles || createDefaultEmbedProfiles();
            state.embedProfiles[p] = {
                key: document.getElementById('cq-cfg-embed-key').value.trim(),
                base: document.getElementById('cq-cfg-embed-base').value.trim() || def.base,
                model: getUserscriptSelectValue('cq-cfg-embed-model', def.embedModel),
                rerankModel: getUserscriptSelectValue('cq-cfg-rerank-model', def.rerankModel)
            };
        }

        function loadUserscriptEmbedProfileToForm(ep) {
            const mode = ep || 'same';
            const effP = mode === 'same' ? normalizeProvider(document.getElementById('cq-cfg-provider').value) : normalizeProvider(mode);
            const def = PROVIDER_DEFAULTS[effP];
            ensureProviderProfiles(state);
            const prof = state.embedProfiles[effP] || { key: '', base: def.base, model: def.embedModel, rerankModel: def.rerankModel };
            if (mode !== 'same') {
                const keyEl = document.getElementById('cq-cfg-embed-key');
                const baseEl = document.getElementById('cq-cfg-embed-base');
                keyEl.value = prof.key || '';
                keyEl.placeholder = def.keyPlaceholder;
                baseEl.value = prof.base || def.base;
                baseEl.placeholder = def.basePlaceholder;
            }
            populateEmbedRerankModels(effP, null, prof.model || def.embedModel, null, prof.rerankModel || def.rerankModel);
        }

        function checkUserscriptKeyMismatch(provider, key) {
            const p = normalizeProvider(provider);
            const k = (key || '').trim();
            if (!k) return '';
            if (p === 'gemini' && k.startsWith('sk-')) return 'Gemini 接口却填了 sk- 开头密钥';
            if (p === 'siliconflow' && k.startsWith('AIza')) return '硅基流动却填了 AIza 开头密钥';
            return '';
        }

        function renderPanelState() {
            ensureProviderProfiles(state);
            const sel = document.getElementById('cq-branch-select');
            setSafeHTML(sel, '');
            state.branchList.forEach(b => {
                const opt = document.createElement('option');
                opt.value = b;
                opt.textContent = `branches/${b}.json`;
                if (b === state.currentBranch) opt.selected = true;
                sel.appendChild(opt);
            });
            document.getElementById('cq-pill-branch').textContent = `[${state.currentBranch}]`;

            const tagBox = document.getElementById('cq-tag-container');
            setSafeHTML(tagBox, '');
            state.customTags.forEach(t => {
                const span = document.createElement('span');
                span.className = `cq-tag ${state.selectedTags.has(t) ? 'active' : ''}`;
                span.textContent = `#${t}`;
                span.addEventListener('click', () => {
                    if (state.selectedTags.has(t)) state.selectedTags.delete(t);
                    else state.selectedTags.add(t);
                    saveConfig();
                    renderPanelState();
                });
                tagBox.appendChild(span);
            });

            const prov = normalizeProvider(state.apiProvider);
            const embedProv = state.embedProvider || 'same';
            uiActiveChatProv = prov;
            uiActiveEmbedProv = embedProv;

            state.chatProfiles[prov] = {
                key: state.geminiKey || state.chatProfiles[prov].key || '',
                base: state.geminiBase || state.chatProfiles[prov].base || PROVIDER_DEFAULTS[prov].base,
                model: state.chatModel || state.chatProfiles[prov].model || PROVIDER_DEFAULTS[prov].chatModel
            };
            if (embedProv !== 'same') {
                const epKey = normalizeProvider(embedProv);
                state.embedProfiles[epKey] = {
                    key: state.embedKey || state.embedProfiles[epKey].key || '',
                    base: state.embedBase || state.embedProfiles[epKey].base || PROVIDER_DEFAULTS[epKey].base,
                    model: state.embedModel || state.embedProfiles[epKey].model || PROVIDER_DEFAULTS[epKey].embedModel,
                    rerankModel: state.rerankModel || state.embedProfiles[epKey].rerankModel || PROVIDER_DEFAULTS[epKey].rerankModel
                };
            } else {
                state.embedProfiles[prov].model = state.embedModel || state.embedProfiles[prov].model;
                state.embedProfiles[prov].rerankModel = state.rerankModel || state.embedProfiles[prov].rerankModel;
            }

            document.getElementById('cq-cfg-provider').value = prov;
            loadUserscriptChatProfileToForm(prov);

            document.getElementById('cq-cfg-embed-provider').value = embedProv;
            toggleUserscriptEmbedBox();
            loadUserscriptEmbedProfileToForm(embedProv);

            document.getElementById('cq-cfg-rerank-enabled').checked = Boolean(state.rerankEnabled);
            document.getElementById('cq-cfg-pat').value = state.githubPat;
            document.getElementById('cq-cfg-repo').value = state.githubRepo;
            document.getElementById('cq-recall-topk').value = state.topK || 5;
            document.getElementById('cq-recall-minscore').value = (typeof state.minScore === 'number') ? state.minScore : 0.38;
            const aiModeSel = document.getElementById('cq-ai-mode');
            if (aiModeSel) {
                aiModeSel.value = ['raw', 'tag_only', 'summarize'].includes(state.archiveMode) ? state.archiveMode : 'tag_only';
            }
        }

        renderPanelState();

        document.getElementById('cq-ai-mode').addEventListener('change', e => {
            const m = e.target.value;
            state.archiveMode = ['raw', 'tag_only', 'summarize'].includes(m) ? m : 'tag_only';
            saveConfig();
        });

        panel.querySelectorAll('.cq-btn-toggle-secret').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = document.getElementById(btn.dataset.target);
                if (!target) return;
                const reveal = target.type === 'password';
                target.type = reveal ? 'text' : 'password';
                btn.textContent = reveal ? '🙈' : '👁️';
            });
        });

        // 事件监听
        document.getElementById('cq-cfg-provider').addEventListener('change', e => {
            saveUserscriptChatFormToProfile(uiActiveChatProv);
            uiActiveChatProv = normalizeProvider(e.target.value);
            loadUserscriptChatProfileToForm(uiActiveChatProv);
            if ((document.getElementById('cq-cfg-embed-provider').value || 'same') === 'same') {
                loadUserscriptEmbedProfileToForm('same');
            }
        });

        document.getElementById('cq-cfg-embed-provider').addEventListener('change', e => {
            saveUserscriptEmbedFormToProfile(uiActiveEmbedProv);
            uiActiveEmbedProv = e.target.value || 'same';
            toggleUserscriptEmbedBox();
            loadUserscriptEmbedProfileToForm(uiActiveEmbedProv);
        });

        async function fetchUserscriptModelsFor(target) {
            const isEmbed = target === 'embed';
            const ep = document.getElementById('cq-cfg-embed-provider').value || 'same';
            const provider = isEmbed ? getEffectiveEmbedProviderKey() : normalizeProvider(document.getElementById('cq-cfg-provider').value);
            const rawKey = (isEmbed && ep !== 'same')
                ? document.getElementById('cq-cfg-embed-key').value.trim()
                : document.getElementById('cq-cfg-key').value.trim();
            const rawBase = (isEmbed && ep !== 'same')
                ? document.getElementById('cq-cfg-embed-base').value.trim()
                : document.getElementById('cq-cfg-base').value.trim();
            const btn = document.getElementById(isEmbed ? 'cq-btn-fetch-embed-models' : 'cq-btn-fetch-models');
            const origText = btn.textContent;
            if (!rawKey) {
                showToast('请先填写 API Key', `请先填入${isEmbed && ep !== 'same' ? '向量/重排' : '总结'} Key 后再拉取`, 'warn');
                return;
            }
            btn.disabled = true;
            btn.textContent = '拉取中...';
            try {
                const resolved = resolveApiEndpoint(provider, rawKey, rawBase);
                let chatModels = [];
                let embedModels = [];
                let rerankModels = [];
                if (resolved.useOpenAI) {
                    const v1Base = resolved.base;
                    if (v1Base.includes('siliconflow.cn')) {
                        const [cRes, eRes, rRes] = await Promise.all([
                            safeFetch(`${v1Base}/models?sub_type=chat`, { headers: { 'Authorization': `Bearer ${resolved.key}` } }),
                            safeFetch(`${v1Base}/models?sub_type=embedding`, { headers: { 'Authorization': `Bearer ${resolved.key}` } }),
                            safeFetch(`${v1Base}/models?sub_type=reranker`, { headers: { 'Authorization': `Bearer ${resolved.key}` } })
                        ]);
                        if (cRes.ok) chatModels = ((await cRes.json()).data || []).map(m => m.id).filter(Boolean);
                        if (eRes.ok) embedModels = ((await eRes.json()).data || []).map(m => m.id).filter(Boolean);
                        if (rRes.ok) rerankModels = ((await rRes.json()).data || []).map(m => m.id).filter(Boolean);
                    }
                    if (chatModels.length === 0 && embedModels.length === 0) {
                        const res = await safeFetch(`${v1Base}/models`, { headers: { 'Authorization': `Bearer ${resolved.key}` } });
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        const ids = ((await res.json()).data || []).map(m => m.id).filter(Boolean);
                        embedModels = ids.filter(id => /embed|bge-(?!rerank)|bce-embedding|m3e|jina-embeddings|text-embedding/i.test(id));
                        rerankModels = ids.filter(id => /rerank/i.test(id));
                        chatModels = ids.filter(id => !/embed|rerank|flux|stable-diffusion|whisper|tts|fishaudio|cosyvoice|sensevoice|video/i.test(id));
                    }
                } else {
                    const res = await safeFetch(`${resolved.base}/v1beta/models?key=${encodeURIComponent(resolved.key)}&pageSize=100`);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const data = await res.json();
                    (data.models || []).forEach(m => {
                        const id = (m.name || '').replace(/^models\//, '');
                        if (!id) return;
                        const methods = m.supportedGenerationMethods || [];
                        if (methods.includes('embedContent') || id.includes('embedding')) embedModels.push(id);
                        if (methods.includes('generateContent')) chatModels.push(id);
                    });
                }
                const pKey = resolved.provider;
                if (!chatModels.length) chatModels = PRESET_MODELS[pKey].chat;
                if (!embedModels.length) embedModels = PRESET_MODELS[pKey].embed;
                if (!rerankModels.length) rerankModels = PRESET_MODELS[pKey].rerank;
                state.fetchedModels = state.fetchedModels || {};
                state.fetchedModels[pKey] = { chat: chatModels, embed: embedModels, rerank: rerankModels };
                saveConfig();
                if (!isEmbed) {
                    populateChatModels(pKey, chatModels, getUserscriptSelectValue('cq-cfg-chat-model', PROVIDER_DEFAULTS[pKey].chatModel));
                }
                if (isEmbed || ep === 'same') {
                    populateEmbedRerankModels(pKey, embedModels, getUserscriptSelectValue('cq-cfg-embed-model', PROVIDER_DEFAULTS[pKey].embedModel), rerankModels, getUserscriptSelectValue('cq-cfg-rerank-model', PROVIDER_DEFAULTS[pKey].rerankModel));
                }
                showToast('模型拉取成功', isEmbed
                    ? `共 ${embedModels.length} 个向量 / ${rerankModels.length} 个重排模型`
                    : `共 ${chatModels.length} 个总结模型`);
            } catch (err) {
                showToast('拉取模型失败', err.message, 'err');
            } finally {
                btn.disabled = false;
                btn.textContent = origText;
            }
        }

        document.getElementById('cq-btn-fetch-models').addEventListener('click', () => fetchUserscriptModelsFor('chat'));
        document.getElementById('cq-btn-fetch-embed-models').addEventListener('click', () => fetchUserscriptModelsFor('embed'));

        document.getElementById('cq-btn-test-chat').addEventListener('click', async () => {
            const btn = document.getElementById('cq-btn-test-chat');
            const provider = normalizeProvider(document.getElementById('cq-cfg-provider').value);
            const rawKey = document.getElementById('cq-cfg-key').value.trim();
            const rawBase = document.getElementById('cq-cfg-base').value.trim();
            const model = getUserscriptSelectValue('cq-cfg-chat-model', PROVIDER_DEFAULTS[provider].chatModel);
            if (!rawKey) {
                showToast('请先填 Key', '请先填入总结接口 API Key', 'warn');
                return;
            }
            const mismatch = checkUserscriptKeyMismatch(provider, rawKey);
            if (mismatch) showToast('密钥前缀提醒', mismatch, 'warn');

            const resolved = resolveApiEndpoint(provider, rawKey, rawBase);
            btn.disabled = true;
            btn.textContent = '⏳';
            const t0 = Date.now();
            try {
                if (resolved.useOpenAI) {
                    const res = await safeFetch(`${resolved.base}/chat/completions`, {
                        method: 'POST',
                        timeout: 25000,
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resolved.key}` },
                        body: JSON.stringify({ model, messages: [{ role: 'user', content: '请仅回复OK两个字母' }], max_tokens: 16 })
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
                    const data = await res.json();
                    const reply = (data.choices?.[0]?.message?.content || '').trim();
                    showToast('总结接口测试通过', `[${model}] ${Date.now() - t0}ms，回复: ${(reply || 'OK').slice(0, 24)}`);
                } else {
                    const res = await safeFetch(`${resolved.base}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(resolved.key)}`, {
                        method: 'POST',
                        timeout: 25000,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ role: 'user', parts: [{ text: '请仅回复OK两个字母' }] }],
                            generationConfig: { maxOutputTokens: 16 },
                            safetySettings: [
                                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                                { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
                            ]
                        })
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
                    const data = await res.json();
                    const reply = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
                    showToast('总结接口测试通过', `[${model}] ${Date.now() - t0}ms，回复: ${(reply || 'OK').slice(0, 24)}`);
                }
            } catch (err) {
                showToast('总结接口测试失败', err.message, 'err');
            } finally {
                btn.disabled = false;
                btn.textContent = '🧪 测试';
            }
        });

        document.getElementById('cq-btn-test-embed').addEventListener('click', async () => {
            const btn = document.getElementById('cq-btn-test-embed');
            const ep = document.getElementById('cq-cfg-embed-provider').value || 'same';
            const provider = getEffectiveEmbedProviderKey();
            const rawKey = ep === 'same'
                ? document.getElementById('cq-cfg-key').value.trim()
                : document.getElementById('cq-cfg-embed-key').value.trim();
            const rawBase = ep === 'same'
                ? document.getElementById('cq-cfg-base').value.trim()
                : document.getElementById('cq-cfg-embed-base').value.trim();
            const embedModel = getUserscriptSelectValue('cq-cfg-embed-model', PROVIDER_DEFAULTS[provider].embedModel);
            if (!rawKey) {
                showToast('请先填 Key', `请先填入${ep === 'same' ? '总结' : '向量'}接口 API Key`, 'warn');
                return;
            }
            const mismatch = checkUserscriptKeyMismatch(provider, rawKey);
            if (mismatch) showToast('密钥前缀提醒', mismatch, 'warn');

            const resolved = resolveApiEndpoint(provider, rawKey, rawBase);
            btn.disabled = true;
            btn.textContent = '⏳';
            const t0 = Date.now();
            try {
                let dim = 0;
                if (resolved.useOpenAI) {
                    const payload = { model: embedModel, input: '测试记忆向量连通性' };
                    if (resolved.provider === 'siliconflow') payload.encoding_format = 'float';
                    const res = await safeFetch(`${resolved.base}/embeddings`, {
                        method: 'POST',
                        timeout: 25000,
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resolved.key}` },
                        body: JSON.stringify(payload)
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
                    const data = await res.json();
                    const emb = data.data?.[0]?.embedding;
                    if (!Array.isArray(emb) || !emb.length) throw new Error('未返回有效向量');
                    dim = emb.length;
                } else {
                    const res = await safeFetch(`${resolved.base}/v1beta/models/${embedModel}:embedContent?key=${encodeURIComponent(resolved.key)}`, {
                        method: 'POST',
                        timeout: 25000,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ model: `models/${embedModel}`, content: { parts: [{ text: '测试记忆向量连通性' }] } })
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
                    const data = await res.json();
                    const vals = data.embedding?.values;
                    if (!Array.isArray(vals) || !vals.length) throw new Error('未返回有效向量');
                    dim = vals.length;
                }
                showToast('向量接口测试通过', `[${embedModel}] ${dim} 维 (${Date.now() - t0}ms)`);
            } catch (err) {
                showToast('向量接口测试失败', err.message, 'err');
            } finally {
                btn.disabled = false;
                btn.textContent = '🧪 测试';
            }
        });

        pill.addEventListener('click', () => {
            state.panelOpen = !state.panelOpen;
            panel.classList.toggle('open', state.panelOpen);
        });
        document.getElementById('cq-btn-close').addEventListener('click', () => {
            state.panelOpen = false;
            panel.classList.remove('open');
        });

        document.getElementById('cq-branch-select').addEventListener('change', e => {
            state.currentBranch = e.target.value;
            saveConfig();
            renderPanelState();
            showToast('已切换分支', `当前归档目标: branches/${state.currentBranch}.json`);
        });

        async function syncProfileFromGithub(silent = false) {
            if (!state.githubPat || !state.githubRepo) {
                if (!silent) showToast('请先配置 GitHub', '展开下方 ⚙️ 填入 PAT 与 Repo', 'warn');
                return;
            }
            try {
                const [remote, discovered] = await Promise.all([
                    githubGetFile('global_profile.json'),
                    githubListBranchFiles()
                ]);
                if (remote?.json) {
                    const remoteBranches = Array.isArray(remote.json.branchList) ? remote.json.branchList : state.branchList;
                    const merged = Array.from(new Set([...remoteBranches, ...discovered]));
                    if (merged.length > 0) {
                        state.branchList = merged;
                        if (!state.branchList.includes(state.currentBranch)) {
                            state.currentBranch = state.branchList[0];
                        }
                    }
                    if (Array.isArray(remote.json.customTags)) state.customTags = remote.json.customTags;
                    if (typeof remote.json.persona === 'string') state.persona = remote.json.persona;
                    if (remote.json.branchPersonas && typeof remote.json.branchPersonas === 'object' && !Array.isArray(remote.json.branchPersonas)) {
                        state.branchPersonas = remote.json.branchPersonas;
                    }
                    saveConfig();
                    renderPanelState();
                    if (!silent) {
                        showToast('同步成功', '已从 GitHub 同步最新分支列表与自定义标签池');
                    }
                }
            } catch (err) {
                if (!silent) showToast('同步失败', err.message, 'err');
            }
        }

        document.getElementById('cq-recall-topk').addEventListener('change', e => {
            state.topK = Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 5));
            e.target.value = state.topK;
            saveConfig();
        });
        document.getElementById('cq-recall-minscore').addEventListener('change', e => {
            const v = parseFloat(e.target.value);
            state.minScore = Number.isFinite(v) ? Math.min(0.95, Math.max(0, v)) : 0.38;
            e.target.value = state.minScore;
            saveConfig();
        });

        document.getElementById('cq-btn-save-cfg').addEventListener('click', async () => {
            const prov = normalizeProvider(document.getElementById('cq-cfg-provider').value);
            const ep = document.getElementById('cq-cfg-embed-provider').value || 'same';
            const effEmbedProv = ep === 'same' ? prov : normalizeProvider(ep);

            saveUserscriptChatFormToProfile(prov);
            if (ep !== 'same') {
                saveUserscriptEmbedFormToProfile(effEmbedProv);
            } else {
                state.embedProfiles[prov] = {
                    ...state.embedProfiles[prov],
                    model: getUserscriptSelectValue('cq-cfg-embed-model', PROVIDER_DEFAULTS[prov].embedModel),
                    rerankModel: getUserscriptSelectValue('cq-cfg-rerank-model', PROVIDER_DEFAULTS[prov].rerankModel)
                };
            }

            state.apiProvider = prov;
            state.geminiKey = state.chatProfiles[prov].key;
            state.geminiBase = state.chatProfiles[prov].base || PROVIDER_DEFAULTS[prov].base;
            state.chatModel = state.chatProfiles[prov].model || PROVIDER_DEFAULTS[prov].chatModel;

            state.embedProvider = ep;
            if (ep !== 'same') {
                state.embedKey = state.embedProfiles[effEmbedProv].key;
                state.embedBase = state.embedProfiles[effEmbedProv].base || PROVIDER_DEFAULTS[effEmbedProv].base;
                state.embedModel = state.embedProfiles[effEmbedProv].model || PROVIDER_DEFAULTS[effEmbedProv].embedModel;
                state.rerankModel = state.embedProfiles[effEmbedProv].rerankModel || PROVIDER_DEFAULTS[effEmbedProv].rerankModel;
            } else {
                state.embedKey = '';
                state.embedBase = PROVIDER_DEFAULTS[prov].base;
                state.embedModel = state.embedProfiles[prov].model || PROVIDER_DEFAULTS[prov].embedModel;
                state.rerankModel = state.embedProfiles[prov].rerankModel || PROVIDER_DEFAULTS[prov].rerankModel;
            }

            state.rerankEnabled = document.getElementById('cq-cfg-rerank-enabled').checked;
            state.githubPat = document.getElementById('cq-cfg-pat').value.trim();
            state.githubRepo = document.getElementById('cq-cfg-repo').value.trim();
            saveConfig();
            showToast('配置已保存', '正在从 GitHub 同步你的分支隔间与标签...');
            if (state.githubPat && state.githubRepo) {
                await syncProfileFromGithub(false);
            }
        });

        document.getElementById('cq-btn-sync-profile').addEventListener('click', () => syncProfileFromGithub(false));

        document.getElementById('cq-btn-scrape-preview').addEventListener('click', () => {
            const scraped = scrapeOfficialGeminiChat(4);
            document.getElementById('cq-archive-preview').value = scraped;
            showToast('已抓取页面对话', `共提取 ${scraped.length} 字，可直接点击归档`);
        });

        // 核心动作 1：免复制一键抓对话 + 摘要 + 算向量 + 推 GitHub
        document.getElementById('cq-btn-oneclick-archive').addEventListener('click', async () => {
            if (!state.githubPat || !state.githubRepo) {
                showToast('未配置 GitHub 仓库', '请先展开下方 ⚙️ 填写 GitHub PAT 与仓库名', 'warn');
                return;
            }
            let rawText = document.getElementById('cq-archive-preview').value.trim();
            if (!rawText) {
                rawText = scrapeOfficialGeminiChat(4);
                document.getElementById('cq-archive-preview').value = rawText;
            }
            if (!rawText) {
                showToast('未检测到对话内容', '请确保当前页面有对话记录', 'warn');
                return;
            }

            const btn = document.getElementById('cq-btn-oneclick-archive');
            const origText = btn.textContent;
            btn.disabled = true;
            btn.textContent = '⏳ 正在处理并算向量...';
            try {
                const mode = document.getElementById('cq-ai-mode').value || 'tag_only';
                let finalText = rawText;
                let finalTags = Array.from(state.selectedTags);
                let finalEvent = '官网一键归档';
                if (mode === 'summarize') {
                    const sum = await summarizeViaGemini(rawText);
                    if (sum.text) finalText = sum.text;
                    if (Array.isArray(sum.tags)) finalTags = Array.from(new Set([...finalTags, ...sum.tags]));
                } else if (mode === 'tag_only') {
                    const tagged = await tagOnlyViaGemini(rawText);
                    if (Array.isArray(tagged.tags)) finalTags = Array.from(new Set([...finalTags, ...tagged.tags]));
                    if (tagged.eventType) finalEvent = tagged.eventType;
                }
                const vec = await getEmbeddingVector(`${finalEvent} ${finalTags.join(' ')} ${finalText}`);
                const path = `branches/${state.currentBranch}.json`;
                const remote = await githubGetFile(path);
                const slices = Array.isArray(remote?.json) ? remote.json : [];
                slices.push({
                    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
                    text: finalText,
                    date: getLocalDateStr(),
                    tags: finalTags.length ? finalTags : ['日常点滴'],
                    event: finalEvent,
                    vector: vec
                });
                await githubPutFile(path, slices, remote?.sha, 'Archive from gemini.google.com');
                document.getElementById('cq-archive-preview').value = '';
                showToast('记忆已归档', `已免复制存入 branches/${state.currentBranch}.json (${slices.length} 条)`);
            } catch (err) {
                showToast('归档失败', err.message, 'err');
            } finally {
                btn.disabled = false;
                btn.textContent = origText;
            }
        });

        // 核心动作 2：一键从 GitHub 检索 Top-K 记忆并直接塞进官网输入框（余弦 + 关键词加分 + 阈值过滤）
        document.getElementById('cq-btn-recall-inject').addEventListener('click', async () => {
            if (!state.githubPat || !state.githubRepo) {
                showToast('未配置 GitHub 仓库', '请先展开下方 ⚙️ 填写 GitHub PAT 与仓库名', 'warn');
                return;
            }
            const userQuery = document.getElementById('cq-recall-input').value.trim() || getOfficialInputDraft();
            const query = userQuery || '近期重要记忆';
            const topK = Math.max(1, parseInt(document.getElementById('cq-recall-topk').value, 10) || state.topK || 5);
            const rawMinScore = parseFloat(document.getElementById('cq-recall-minscore').value);
            const minScore = userQuery ? (Number.isFinite(rawMinScore) ? rawMinScore : 0.38) : 0;

            const btn = document.getElementById('cq-btn-recall-inject');
            btn.disabled = true;
            btn.textContent = '检索中...';
            try {
                const path = `branches/${state.currentBranch}.json`;
                const remote = await githubGetFile(path);
                const slices = Array.isArray(remote?.json) ? remote.json : [];
                if (slices.length === 0) {
                    showToast('当前分支为空', `branches/${state.currentBranch}.json 暂无记忆`, 'warn');
                    return;
                }
                const qVec = await getEmbeddingVector(query);
                const cleanQ = query.trim().toLowerCase();
                const scoredAll = slices.map(s => {
                    const cos = cosineSimilarity(qVec, s.vector || []);
                    const textHay = `${s.text || ''} ${(s.tags || []).join(' ')} ${s.event || ''}`.toLowerCase();
                    const exactBonus = (cleanQ.length >= 2 && textHay.includes(cleanQ)) ? 0.25 : 0;
                    const lex = lexicalOverlapScore(query, s);
                    const score = cos + (exactBonus || lex * 0.5);
                    return { slice: s, score, exactBonus };
                }).sort((a, b) => b.score - a.score);

                let scored = null;
                if (state.rerankEnabled && getEmbedApiConfig().useOpenAI && scoredAll.length > 1) {
                    const coarsePool = scoredAll.slice(0, Math.max(topK * 3, 15));
                    scored = await rerankCandidates(query, coarsePool, topK, minScore);
                }
                if (scored === null) {
                    scored = scoredAll
                        .filter(item => minScore <= 0 || item.score >= minScore)
                        .slice(0, topK)
                        .map(({ slice, score }) => ({ slice, score }));
                }

                if (scored.length === 0) {
                    showToast('未命中相关记忆', `相关度均低于 ${(minScore * 100).toFixed(0)}%，已过滤无关切片`, 'warn');
                    return;
                }

                const branchPersona = (state.branchPersonas && state.branchPersonas[state.currentBranch]) || '';
                const effectivePersona = [state.persona, branchPersona].map(s => (s || '').trim()).filter(Boolean).join('\n\n');
                const header = `【✉️ 初晴 · 唤醒记忆档案 (${state.currentBranch})】\n` +
                    (effectivePersona ? `▸ 核心设定：\n${effectivePersona}\n` : '') +
                    scored.map((r, i) => `${i + 1}. [${r.slice.date} | #${(r.slice.tags || []).join(' #')} | 相关度 ${(r.score * 100).toFixed(0)}%]: ${r.slice.text}`).join('\n') +
                    `\n---\n`;

                const ok = fillOfficialGeminiInput(header);
                if (ok) {
                    showToast('已填入官网输入框', `成功唤醒 Top-${scored.length} 条记忆并塞入输入框！`);
                } else {
                    await navigator.clipboard.writeText(header);
                    showToast('已复制到剪贴板', '未找到输入框焦点，已自动复制，直接粘贴即可');
                }
            } catch (err) {
                showToast('唤醒失败', err.message, 'err');
            } finally {
                btn.disabled = false;
                btn.textContent = '🔮 唤醒并填入';
            }
        });

        if (state.githubPat && state.githubRepo) {
            syncProfileFromGithub(true);
        }
    }

    setTimeout(createUI, 1200);
    setInterval(() => {
        if (!document.getElementById('cq-floating-pill')) {
            createUI();
        }
    }, 2500);
})();
