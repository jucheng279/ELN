import type { ReactNode } from 'react';
import { FlaskConical } from 'lucide-react';

interface AuthLayoutProps {
  children: ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f8f9fa] px-4 py-12">
      {/* Branding */}
      <div className="mb-8 flex items-center gap-2.5">
        <FlaskConical size={28} className="text-blue-600" strokeWidth={1.75} />
        <span className="text-2xl font-semibold tracking-tight text-gray-900">
          LabNote
        </span>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm">
        {children}
      </div>

      {/* Footer */}
      <p className="mt-8 text-xs text-gray-400">
        &copy; {new Date().getFullYear()} LabNote. All rights reserved.
      </p>
    </div>
  );
}
