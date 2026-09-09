'use strict';

const API_URL = 'https://nvbxjmunpqswhvqljjed.supabase.co/functions/v1/kira-miniapp';
const telegram = window.Telegram && window.Telegram.WebApp;
const $ = (selector) => document.querySelector(selector);
const messages = $('#messages');
const input = $('#input');
const sendButton = $('#send');
const toolResult = $('#toolResult');
const toast = $('#toast');
let toastTimer;
let chatRequestInFlight = false;

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
  return element;
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
  const value = data.reply || data.text || data.result || data.message || data.answer || data.content;
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
}

function showImage(data) {
  const imageUrl = data.url || data.image_url || (data.image && data.image.url);
  const base64 = data.b64_json || (data.image && data.image.b64_json);
  if (!imageUrl && !base64) return false;
  toolResult.replaceChildren();
  const caption = document.createElement('div');
  caption.textContent = data.message || 'Образ готов.';
  const image = new Image();
  image.alt = 'Изображение, созданное Kira';
  image.src = imageUrl || `data:image/png;base64,${base64}`;
  toolResult.append(caption, image);
  toolResult.style.display = 'block';
  return true;
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

  showToolText('Kira готовит результат…');
  const button = document.querySelector(`.tool[data-action="${action}"]`);
  if (button) button.disabled = true;
  try {
    const data = await request(action, payload);
    if (action !== 'image' || !showImage(data)) showToolText(responseText(data));
  } catch (error) {
    showToolText(errorText(error));
    showToast('Модуль временно недоступен');
  } finally {
    if (button) button.disabled = false;
  }
}

function setProfile(profile = {}) {
  const telegramUser = getTelegramUser();
  const name = profile.first_name || profile.name || profile.username || userName(telegramUser);
  const id = profile.telegram_user_id || profile.telegramId || profile.id || (telegramUser && telegramUser.id) || '—';
  $('#pname').textContent = name;
  $('#pid').textContent = id;
  $('#headerName').textContent = name;
}

async function loadProfile() {
  setProfile();
  if (!telegram || !telegram.initData) return;
  try {
    const data = await request('profile');
    setProfile(data.profile || data.user || data);
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
