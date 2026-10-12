import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog } from './dialog';

describe('Диалог библиотеки компонентов', () => {
  it('не рендерит содержимое, пока закрыт', () => {
    render(
      <Dialog open={false} title="Заголовок">
        <p>Содержимое</p>
      </Dialog>,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('по умолчанию занимает обычную ширину', () => {
    render(
      <Dialog open title="Заголовок">
        <p>Содержимое</p>
      </Dialog>,
    );

    expect(screen.getByRole('dialog').className).toContain('max-w-md');
  });

  it('поддерживает широкое окно для таблиц и отчётов', () => {
    // Диалог загрузки номенклатуры показывает предпросмотр и список ошибок — в узкое окно не влезает.
    render(
      <Dialog open size="lg" title="Загрузка">
        <p>Содержимое</p>
      </Dialog>,
    );

    expect(screen.getByRole('dialog').className).toContain('max-w-3xl');
  });

  it('закрывается по клику на фон, но не по клику внутри окна', () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="Заголовок" onClose={onClose}>
        <p>Содержимое</p>
      </Dialog>,
    );

    fireEvent.click(screen.getByText('Содержимое'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
