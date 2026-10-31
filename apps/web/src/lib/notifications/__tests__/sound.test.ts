import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { playNotificationSound, prepareSound, resetSoundForTests, soundSupported } from '../sound';

/**
 * Звук уведомления (уровень 1, 01.11.2026).
 *
 * Требование владельца: короткий сигнал осциллятором 0.15 с, а не файл; при `suspended`
 * не шуметь — браузер всё равно заблокирует автоплей.
 */

interface FakeOscillator {
  type: string;
  frequency: { setValueAtTime: (value: number, at: number) => void };
  connect: (node: unknown) => void;
  start: (at: number) => void;
  stop: (at: number) => void;
}

let oscillators: FakeOscillator[] = [];
let contextState: 'suspended' | 'running' = 'running';
let resume: ReturnType<typeof vi.fn>;
let constructed = 0;

class FakeAudioContext {
  state = contextState;
  currentTime = 0;
  destination = { id: 'destination' };
  resume = resume;

  constructor() {
    constructed += 1;
    this.state = contextState;
  }

  createOscillator(): FakeOscillator {
    const oscillator: FakeOscillator = {
      type: 'sine',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    oscillators.push(oscillator);
    return oscillator;
  }

  createGain() {
    return {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
  }
}

beforeEach(() => {
  oscillators = [];
  constructed = 0;
  contextState = 'running';
  resume = vi.fn(async () => undefined);
  resetSoundForTests();
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
});

afterEach(() => {
  (window as unknown as { AudioContext?: unknown }).AudioContext = undefined;
  resetSoundForTests();
});

describe('поддержка', () => {
  it('браузер без Web Audio — тихая деградация', () => {
    (window as unknown as { AudioContext?: unknown }).AudioContext = undefined;
    expect(soundSupported()).toBe(false);
    expect(prepareSound()).toBe(false);
    expect(playNotificationSound()).toBe(false);
  });
});

describe('сигнал', () => {
  it('до подготовки контекста сигнал молчит — ничего не создаётся', () => {
    expect(playNotificationSound()).toBe(false);
    expect(oscillators).toHaveLength(0);
  });

  it('после подготовки играет короткий сигнал 0.15 с', () => {
    expect(prepareSound()).toBe(true);
    expect(playNotificationSound()).toBe(true);

    expect(oscillators).toHaveLength(1);
    expect(oscillators[0].start).toHaveBeenCalledWith(0);
    expect(oscillators[0].stop).toHaveBeenCalledWith(0.15);
  });

  it('в состоянии suspended не шумит', () => {
    contextState = 'suspended';
    // prepareSound пытается разбудить контекст, но состояние остаётся suspended.
    prepareSound();

    expect(playNotificationSound()).toBe(false);
    expect(oscillators).toHaveLength(0);
    expect(resume).toHaveBeenCalled();
  });

  it('контекст создаётся один раз на приложение', () => {
    prepareSound();
    prepareSound();
    prepareSound();
    expect(constructed).toBe(1);
  });

  it('ошибка создания контекста не ломает приложение', () => {
    (window as unknown as { AudioContext: unknown }).AudioContext = class {
      constructor() {
        throw new Error('nope');
      }
    };
    expect(prepareSound()).toBe(false);
    expect(playNotificationSound()).toBe(false);
  });
});
