import { Button } from '@prodtrack/ui';

interface LogoutButtonProps {
  className?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'cta';
}

export function LogoutButton({ className = '', variant = 'secondary' }: LogoutButtonProps) {
  return (
    <form action="/api/auth/logout" method="POST">
      <Button type="submit" variant={variant} size="sm" className={className}>
        Выйти
      </Button>
    </form>
  );
}
