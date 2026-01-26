import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import Image from 'next/image';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <div className="flex items-center gap-2 text-md">
          <Image
            src="/icon-variations/11-stack-gradient.svg"
            alt="RippleDB"
            width={36}
            height={36}
            className="dark:invert"
          />
          <span>RippleDB</span>
        </div>
      ),
    },
  };
}
