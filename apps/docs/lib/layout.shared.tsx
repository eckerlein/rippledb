import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import Image from 'next/image';
import { GradientText } from '@/components/ui/gradient-text';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <div className="flex items-center gap-2 text-2xl">
          <div className="relative w-9 h-9">
            <Image
              src="/icon-variations/icon-light.svg"
              alt="RippleDB"
              width={36}
              height={36}
              className="dark:hidden"
            />
            <Image
              src="/icon-variations/icon-dark.svg"
              alt="RippleDB"
              width={36}
              height={36}
              className="hidden dark:block"
            />
          </div>
          <span>
            Ripple
            <GradientText>DB</GradientText>
          </span>
        </div>
      ),
    },
  };
}
