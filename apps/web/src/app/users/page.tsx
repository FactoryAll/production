// TODO T-022: реализовать UI создания пользователей администратором (BR-8)
// Пока роут зарезервирован для middleware (permission users:manage).

export default function UsersPage() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">Пользователи</h1>
      <p className="text-neutral-600">Управление пользователями — T-022.</p>
    </main>
  );
}
