export function LoadingScreen({
  message = 'Loading your workspace...',
}: {
  message?: string;
}) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="text-center">
        <div className="w-10 h-10 mx-auto rounded-full border-4 border-slate-200 border-t-indigo-600 animate-spin" />
        <p className="mt-4 text-sm text-app-faint">{message}</p>
      </div>
    </div>
  );
}
