import type { ReactNode } from 'react';
import { FlaskConical } from 'lucide-react';

interface AuthLayoutProps {
  children: ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted px-4 py-12">
      {/* Branding */}
      <div className="mb-8 flex items-center gap-2">
        <FlaskConical size={24} className="text-foreground" strokeWidth={1.75} />
        <span className="text-xl font-semibold tracking-tight text-foreground">
          LabNote
        </span>
      </div>

      {/* Content */}
      <div className="w-full max-w-sm">{children}</div>

      {/* Footer */}
      <p className="mt-8 text-xs text-muted-foreground">
        &copy; {new Date().getFullYear()} LabNote. All rights reserved.
      </p>
    </div>
  );
}
