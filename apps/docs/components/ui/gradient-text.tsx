import { cn } from '@/lib/utils';

export interface GradientTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  /**
   * The gradient colors. Can be Tailwind color classes or custom colors.
   * @default Uses theme-aware icon colors
   */
  gradient?: string;
  /**
   * Animation duration in seconds
   * @default 4
   */
  duration?: number;
  /**
   * Whether to animate the gradient
   * @default true
   */
  animate?: boolean;
}

export function GradientText({
  children,
  className,
  gradient,
  duration = 4,
  animate = true,
  ...props
}: GradientTextProps) {
  // Default to theme-aware icon colors if not provided
  const defaultGradient =
    'from-icon-primary-light via-icon-secondary-light to-icon-primary-light dark:from-icon-primary-dark dark:via-icon-secondary-dark dark:to-icon-primary-dark';

  return (
    <span
      className={cn(
        'bg-gradient-to-r bg-clip-text text-transparent',
        gradient || defaultGradient,
        animate && 'animate-gradient-shift',
        className
      )}
      style={{
        ...(animate
          ? {
              backgroundSize: '200% auto',
              animation: `gradient-shift ${duration}s ease-in-out infinite`,
            }
          : {}),
        fontFeatureSettings: '"liga" 1, "kern" 1',
        textRendering: 'optimizeLegibility',
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
        transform: 'translateZ(0)',
        willChange: 'auto',
        ...props.style,
      }}
      {...props}
    >
      {children}
    </span>
  );
}
