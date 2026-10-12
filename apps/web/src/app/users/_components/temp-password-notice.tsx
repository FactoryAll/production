'use client';

import { useState } from 'react';

interface TempPasswordNoticeProps {
  password: string;
  login: string;
}

/**
 * Временный пароль показывается один раз: в базе лежит только хэш, восстановить значение нельзя.
 * Поэтому рядом — кнопка копирования и напоминание, что при входе пароль придётся сменить (Р-15).
 */
export function TempPasswordNotice({ password, login }: TempPasswordNoticeProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-mist-metal bg-graphite-surface p-3">
      <p className="text-sm text-graphite">
        Временный пароль для пользователя <span className="font-medium">{login}</span> показан один раз:
        передайте его пользователю. При первом входе система потребует сменить пароль.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <code className="rounded-md border border-mist-metal bg-white px-3 py-2 font-mono text-base text-graphite">
          {password}
        </code>
        <button type="button" onClick={copy} className="text-sm text-deep-industry-blue hover:underline">
          {copied ? 'Скопировано' : 'Скопировать'}
        </button>
      </div>
    </div>
  );
}
