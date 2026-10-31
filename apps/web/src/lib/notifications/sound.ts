/**
 * Короткий сигнал о новом уведомлении (уровень 1, 01.11.2026).
 *
 * Звук синтезируется осциллятором (0.15 с), файла нет. Браузеры запрещают звук до первого
 * действия на странице, поэтому:
 *   — `AudioContext` создаётся только по действию пользователя (кнопка «Включить звук»),
 *   — если контекст в состоянии `suspended`, сигнал НЕ играем: лучше тишина, чем ошибка в консоли.
 */

let audioContext: AudioContext | null = null;

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const ctor =
    (window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor })
      .AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  return ctor ?? null;
}

/** Поддерживается ли звук в этом браузере. */
export function soundSupported(): boolean {
  return audioContextCtor() !== null;
}

/**
 * Разбудить звук по действию пользователя. Возвращает true, если контекст готов играть.
 * Если браузер не умеет Web Audio — тихо возвращаем false.
 */
export function prepareSound(): boolean {
  const ctor = audioContextCtor();
  if (ctor === null) {
    return false;
  }
  if (audioContext === null) {
    try {
      audioContext = new ctor();
    } catch {
      return false;
    }
  }
  if (audioContext.state === 'suspended') {
    void audioContext.resume().catch(() => {
      // Пользователь ещё не взаимодействовал — остаёмся в тишине.
    });
  }
  return audioContext.state === 'running';
}

/** Короткий сигнал. Молчит, если контекст не готов играть. */
export function playNotificationSound(): boolean {
  const context = audioContext;
  if (context === null || context.state !== 'running') {
    return false;
  }

  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, now);
    // Затухание: резкий старт и мягкий конец, чтобы сигнал не «щёлкал».
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.15);
    return true;
  } catch {
    return false;
  }
}

/** Только для тестов: забыть созданный контекст. */
export function resetSoundForTests(): void {
  audioContext = null;
}
