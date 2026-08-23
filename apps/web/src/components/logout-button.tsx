import { Button } from '@prodtrack/ui';

export function LogoutButton() {
  return (
    <form action="/api/auth/logout" method="POST">
      <Button type="submit" variant="secondary" size="sm">
        Выйти
      </Button>
    </form>
  );
}
