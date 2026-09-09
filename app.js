'use strict';

const API_URL = 'https://nvbxjmunpqswhvqljjed.supabase.co/functions/v1/kira-miniapp';
const telegram = window.Telegram && window.Telegram.WebApp;
const $ = (selector) => document.querySelector(selector);
const messages = $('#messages');
const input = $('#input');
const sendButton = $('#send');
const toolResult = $('#toolResult');
const toast = $('#toast');
const toolResultActions = $('#toolResultActions');
let toastTimer;
let chatRequestInFlight = false;
let latestToolText = '';
const STORAGE_PREFIX = 'kira-miniapp:';
const FACTS = [
  'Осьминог чувствует вкус щупальцами: на них есть химические рецепторы.',
  'Мёд при правильном хранении может оставаться съедобным очень долго.',
  'У бананов и человека примерно половина общих генов, но это не делает нас похожими.',
  'Молния нагревает воздух вокруг себя сильнее, чем поверхность Солнца.',
  'Сон помогает мозгу упорядочивать новую информацию и закреплять воспоминания.',
];
const IDEAS = [
  'Выбери одну задачу на 15 минут и сделай только её первый шаг прямо сейчас.',
  'Составь список «перестать делать»: иногда освобождённое время полезнее нового плана.',
  'Опиши цель одной фразой, а затем придумай самый маленький проверяемый результат.',
  'Попробуй правило 3 вариантов: перед решением запиши три подхода, даже если первый очевиден.',
  'Преврати повторяющуюся задачу в шаблон: это сэкономит время уже на следующем запуске.',
];

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3200);
}

function getTelegramUser() {
  return telegram && telegram.initDataUnsafe ? telegram.initDataUnsafe.user : null;
}

function userName(user) {
  if (!user) return 'Гость';
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Пользователь';
}

function showPage(pageId) {
  document.querySelectorAll('.page').forEach((page) => {
    page.classList.toggle('active', page.id === pageId);
  });
  document.querySelectorAll('[data-page]').forEach((button) => {
    const isActive = button.dataset.page === pageId;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
  if (pageId === 'profile') loadProfile();
  if (pageId === 'chat') window.setTimeout(() => input.focus(), 150);
}

function appendMessage(text, author = 'ai', extraClass = '') {
  const element = document.createElement('div');
  element.className = `msg ${author} ${extraClass}`.trim();
  element.textContent = String(text);
  messages.appendChild(element);
  messages.scrollTop = messages.scrollHeight;
  if (!extraClass) saveMemory(text, author);
  return element;
}

function storageGet(key, fallback = null) {
  try {
    const value = window.localStorage.getItem(STORAGE_PREFIX + key);
    return value === null ? fallback : JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch (_) {
    // The Mini App still works when private mode blocks local storage.
  }
}

function storageRemove(key) {
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + key);
  } catch (_) {
    // Clearing a local enhancement must not affect the chat itself.
  }
}

function saveMemory(text, author) {
  const memory = storageGet('memory', []);
  memory.push({ text: String(text), author, at: Date.now() });
  storageSet('memory', memory.slice(-20));
}

function createThinkingMessage() {
  const message = appendMessage('Kira думает…', 'ai', 'thinking');
  let dots = 1;
  const interval = window.setInterval(() => {
    dots = dots % 3 + 1;
    message.textContent = `Kira думает${'.'.repeat(dots)}`;
  }, 500);
  return () => {
    window.clearInterval(interval);
    message.remove();
  };
}

function resizeInput() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
}

function parseResponse(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(text || 'Сервис вернул пустой или некорректный ответ.');
  }
}

async function request(action, payload = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, initData: (telegram && telegram.initData) || '', ...payload }),
      signal: controller.signal,
    });
    const data = parseResponse(await response.text());
    if (!response.ok || data.error) {
      throw new Error(data.error || data.message || `Ошибка сервера (${response.status}).`);
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Время ожидания ответа истекло. Попробуйте ещё раз.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function responseText(data) {
  const source = data.data && typeof data.data === 'object' ? { ...data, ...data.data } : data;
  const value = source.reply || source.text || source.result || source.message || source.answer || source.content;
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return value.text || value.message || JSON.stringify(value, null, 2);
  return 'Готово.';
}

function errorText(error) {
  const message = error && error.message ? error.message : 'Неизвестная ошибка.';
  if (/initData|telegram|authoriz|unauthoriz|401/i.test(message)) {
    return 'Откройте Kira из Telegram: для запроса нужен подтверждённый Telegram-профиль.';
  }
  return `Не удалось выполнить запрос: ${message}`;
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text || chatRequestInFlight) return;

  chatRequestInFlight = true;
  input.value = '';
  resizeInput();
  sendButton.disabled = true;
  appendMessage(text, 'user');
  const stopThinking = createThinkingMessage();

  try {
    const data = await request('chat', { message: text });
    appendMessage(responseText(data));
    $('#heroState').textContent = 'На связи с вами';
  } catch (error) {
    appendMessage(errorText(error));
    showToast('Сообщение не отправлено');
  } finally {
    stopThinking();
    chatRequestInFlight = false;
    sendButton.disabled = false;
    input.focus();
  }
}

function showToolText(text) {
  toolResult.replaceChildren();
  toolResult.textContent = text;
  toolResult.style.display = 'block';
  latestToolText = String(text);
  toolResultActions.style.display = 'flex';
}

function beginToolResult() {
  latestToolText = '';
  toolResult.replaceChildren();
  toolResult.style.display = 'block';
  toolResult.textContent = 'Kira готовит результат…';
  toolResultActions.style.display = 'none';
}

function showImage(data) {
  const source = data.data && typeof data.data === 'object' ? { ...data, ...data.data } : data;
  const image = source.image || (Array.isArray(source.images) ? source.images[0] : null) || {};
  const imageUrl = source.url || source.image_url || image.url || image.image_url;
  const base64 = source.b64_json || image.b64_json;
  if (!imageUrl && !base64) return false;
  toolResult.replaceChildren();
  const caption = document.createElement('div');
  caption.textContent = source.message || 'Образ готов.';
  const imageElement = new Image();
  imageElement.alt = 'Изображение, созданное Kira';
  imageElement.src = imageUrl || `data:image/png;base64,${base64}`;
  toolResult.append(caption, imageElement);
  toolResult.style.display = 'block';
  latestToolText = caption.textContent;
  toolResultActions.style.display = 'flex';
  return true;
}

function clearChat() {
  if (chatRequestInFlight) return;
  messages.replaceChildren();
  storageRemove('memory');
  const welcome = document.createElement('div');
  welcome.className = 'msg ai';
  welcome.textContent = 'Диалог очищен. 🦊 Я готова начать заново — что обсудим?';
  messages.appendChild(welcome);
  updateProfileStats();
  showToast('Диалог и локальная память очищены');
}

function continueToolInChat() {
  if (!latestToolText) return;
  showPage('chat');
  input.value = `Продолжим этот результат:\n${latestToolText}\n\n`;
  resizeInput();
  input.focus();
}

async function runTool(action) {
  if (action === 'profile') {
    showPage('profile');
    return;
  }

  let payload = {};
  if (action === 'image') {
    const prompt = window.prompt('Опишите изображение для Kira', 'Атмосферный фиолетовый арт Kira ночью');
    if (!prompt || !prompt.trim()) return;
    payload = { prompt: prompt.trim() };
  }

  beginToolResult();
  const button = document.querySelector(`.tool[data-action="${action}"]`);
  if (button) button.disabled = true;
  try {
    const data = await request(action, payload);
    if (action !== 'image' || !showImage(data)) showToolText(responseText(data));
  } catch (error) {
    if (action === 'image') {
      showToolText(errorText(error));
      showToast('Не удалось создать изображение');
    } else {
      await runBuiltInTool(action);
      showToast('Сервер недоступен: показан локальный результат');
    }
  } finally {
    if (button) button.disabled = false;
  }
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

async function getTonPrice() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd,rub&include_24hr_change=true', { signal: controller.signal });
    if (!response.ok) throw new Error('Курс недоступен');
    const ton = (await response.json())['the-open-network'];
    if (!ton || typeof ton.usd !== 'number') throw new Error('Курс недоступен');
    const change = typeof ton.usd_24h_change === 'number' ? ` (${ton.usd_24h_change >= 0 ? '+' : ''}${ton.usd_24h_change.toFixed(2)}% за 24 ч.)` : '';
    const rub = typeof ton.rub === 'number' ? ` · ₽${ton.rub.toFixed(2)}` : '';
    return `TON: $${ton.usd.toFixed(4)}${rub}${change}\nИсточник: CoinGecko. Данные справочные, не являются инвестиционной рекомендацией.`;
  } finally {
    window.clearTimeout(timeout);
  }
}

function localMemoryResult() {
  const memory = storageGet('memory', []);
  if (!memory.length) return 'Память пока пуста. Напишите Kira сообщение — последние реплики появятся здесь на этом устройстве.';
  return `Последние сохранённые реплики (${memory.length}):\n\n${memory.slice(-8).map((item) => `${item.author === 'user' ? 'Вы' : 'Kira'}: ${item.text}`).join('\n\n')}`;
}

function claimDailyBonus() {
  const today = new Date().toISOString().slice(0, 10);
  const bonus = storageGet('bonus', { total: 0, lastClaim: '' });
  if (bonus.lastClaim === today) return `Бонус за сегодня уже получен. Всего Kira-бонусов: ${bonus.total}. Возвращайтесь завтра!`;
  const reward = 10;
  const updated = { total: Number(bonus.total || 0) + reward, lastClaim: today };
  storageSet('bonus', updated);
  return `Ежедневный бонус получен: +${reward} Kira-бонусов.\nВсего на этом устройстве: ${updated.total}.`;
}

async function runBuiltInTool(action) {
  showToolText('Kira готовит результат…');
  switch (action) {
    case 'fact':
      showToolText(`🎲 Случайный факт\n\n${randomItem(FACTS)}`);
      break;
    case 'idea':
      showToolText(`💡 Свежая идея\n\n${randomItem(IDEAS)}`);
      break;
    case 'mood':
      showToolText('🥰 Настроение Kira: отличное. Я готова разложить любую задачу на ясные шаги.');
      break;
    case 'memory':
      showToolText(`🧠 Память Kira\n\n${localMemoryResult()}`);
      break;
    case 'bonus':
      showToolText(`🎁 ${claimDailyBonus()}`);
      break;
    case 'ton':
      try {
        showToolText(`💎 ${await getTonPrice()}`);
      } catch (_) {
        showToolText('💎 Не удалось получить актуальный курс TON. Проверьте подключение и повторите попытку.');
      }
      break;
    default:
      showToolText('Этот модуль пока не поддерживается.');
  }
}

function setProfile(profile = {}) {
  const telegramUser = getTelegramUser();
  const name = profile.first_name || profile.name || profile.username || userName(telegramUser);
  const id = profile.telegram_user_id || profile.telegramId || profile.id || (telegramUser && telegramUser.id) || '—';
  $('#pname').textContent = name;
  $('#pid').textContent = id;
  $('#headerName').textContent = name;
  updateProfileStats();
}

function updateProfileStats() {
  const memory = storageGet('memory', []);
  const bonus = storageGet('bonus', { total: 0 });
  $('#pmemory').textContent = `${memory.length} ${memory.length === 1 ? 'реплика' : 'реплик'}`;
  $('#pbonus').textContent = String(bonus.total || 0);
}

async function loadProfile() {
  setProfile();
  if (!telegram || !telegram.initData) return;
  try {
    const data = await request('profile');
    const source = data.data && typeof data.data === 'object' ? { ...data, ...data.data } : data;
    setProfile(source.profile || source.user || source);
  } catch (_) {
    // The locally supplied Telegram user remains visible if the profile endpoint is unavailable.
  }
}

function initialiseTelegram() {
  if (!telegram) {
    showToast('Для персонального AI-чата откройте приложение из Telegram.');
    return;
  }
  telegram.ready();
  telegram.expand();
  telegram.setHeaderColor && telegram.setHeaderColor('#090a0f');
  telegram.setBackgroundColor && telegram.setBackgroundColor('#090a0f');
  setProfile();
}

document.querySelectorAll('[data-page]').forEach((button) => {
  button.addEventListener('click', () => showPage(button.dataset.page));
});
document.querySelectorAll('.tool').forEach((button) => {
  button.addEventListener('click', () => runTool(button.dataset.action));
});
document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => {
    input.value = button.dataset.prompt;
    resizeInput();
    input.focus();
  });
});
$('#clearChat').addEventListener('click', clearChat);
$('#sendToolResult').addEventListener('click', continueToolInChat);
sendButton.addEventListener('click', sendMessage);
input.addEventListener('input', resizeInput);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendMessage();
  }
});

initialiseTelegram();
resizeInput();
updateProfileStats();
