'use client';

import FancyText from '@carefully-coded/react-text-gradient';

export function GradientTextWrapper({ children }: { children: React.ReactNode }) {
  return (
    <>
      <FancyText
        gradient={{
          from: 'hsl(217, 91%, 50%)',
          to: 'hsl(258, 89%, 55%)',
          type: 'linear',
        }}
        animate
        animateDuration={4000}
      >
        <span
          className="dark:hidden"
          style={{
            fontFeatureSettings: '"liga" 1, "kern" 1',
            textRendering: 'optimizeLegibility',
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
            transform: 'translateZ(0)',
            willChange: 'auto',
          }}
        >
          {children}
        </span>
      </FancyText>
      <FancyText
        gradient={{
          from: 'hsl(200, 91.30%, 55.10%)',
          to: 'hsl(258, 71.80%, 59.60%)',
          type: 'linear',
        }}
        animate
        animateDuration={4000}
      >
        <span
          className="hidden dark:inline"
          style={{
            fontFeatureSettings: '"liga" 1, "kern" 1',
            textRendering: 'optimizeLegibility',
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
            transform: 'translateZ(0)',
            willChange: 'auto',
          }}
        >
          {children}
        </span>
      </FancyText>
    </>
  );
}
