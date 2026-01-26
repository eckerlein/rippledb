import Link from 'next/link';
import Image from 'next/image';

const designs = [
  {
    name: 'Pulse',
    base: '06-pulse.svg',
    colors: [
      { name: 'Monochrome', file: '06-pulse.svg' },
      { name: 'Blue', file: '06-pulse-blue.svg' },
      { name: 'Purple', file: '06-pulse-purple.svg' },
      { name: 'Teal', file: '06-pulse-teal.svg' },
      { name: 'Gradient', file: '06-pulse-gradient.svg', lightFile: '06-pulse-gradient-light.svg', darkFile: '06-pulse-gradient-dark.svg' },
      { name: 'Bi-Color', file: '06-pulse-bicolor.svg' },
      { name: 'Animated', file: '06-pulse-animated.svg' },
    ],
  },
  {
    name: 'Waves',
    base: '03-waves.svg',
    colors: [
      { name: 'Monochrome', file: '03-waves.svg' },
      { name: 'Blue', file: '03-waves-blue.svg' },
      { name: 'Purple', file: '03-waves-purple.svg' },
      { name: 'Teal', file: '03-waves-teal.svg' },
      { name: 'Gradient', file: '03-waves-gradient.svg' },
      { name: 'Bi-Color', file: '03-waves-bicolor.svg' },
      { name: 'Animated', file: '03-waves-animated.svg' },
      { name: 'Drawing', file: '03-waves-drawing.svg' },
    ],
  },
  {
    name: 'Modern',
    base: '10-modern.svg',
    colors: [
      { name: 'Monochrome', file: '10-modern.svg' },
      { name: 'Blue', file: '10-modern-blue.svg' },
      { name: 'Purple', file: '10-modern-purple.svg' },
      { name: 'Teal', file: '10-modern-teal.svg' },
      { name: 'Gradient', file: '10-modern-gradient.svg' },
      { name: 'Bi-Color', file: '10-modern-bicolor.svg' },
      { name: 'Animated', file: '10-modern-animated.svg' },
    ],
  },
  {
    name: 'Original',
    base: '12-original.svg',
    colors: [
      { name: 'Monochrome', file: '12-original.svg' },
      { name: 'Blue', file: '12-original-blue.svg' },
      { name: 'Purple', file: '12-original-purple.svg' },
      { name: 'Teal', file: '12-original-teal.svg' },
      { name: 'Gradient', file: '12-original-gradient.svg' },
      { name: 'Bi-Color', file: '12-original-bicolor.svg' },
      { name: 'Animated', file: '12-original-animated.svg' },
    ],
  },
  {
    name: 'Stack',
    base: '11-stack.svg',
    colors: [
      { name: 'Monochrome', file: '11-stack.svg' },
      { name: 'Blue', file: '11-stack-blue.svg' },
      { name: 'Purple', file: '11-stack-purple.svg' },
      { name: 'Teal', file: '11-stack-teal.svg' },
      { name: 'Gradient', file: '11-stack-gradient.svg' },
      { name: 'Bi-Color', file: '11-stack-bicolor.svg' },
      { name: 'Animated', file: '11-stack-animated.svg' },
    ],
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-col flex-1 p-8 max-w-6xl mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-2">RippleDB Logo Variations</h1>
        <p className="text-muted-foreground">
          Choose your favorite design. Click any icon to see it larger.
        </p>
      </div>

      <div className="space-y-12 mb-8">
        {designs.map((design) => (
          <div key={design.name} className="space-y-4">
            <h2 className="text-xl font-semibold">{design.name}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
              {design.colors.map((color) => (
                <div
                  key={color.file}
                  className="flex flex-col items-center p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="w-20 h-20 mb-3 flex items-center justify-center bg-background border rounded relative">
                    {color.lightFile && color.darkFile ? (
                      <>
                        <img
                          src={`/icon-variations/${color.lightFile}`}
                          alt={`${design.name} - ${color.name}`}
                          width={40}
                          height={40}
                          className="dark:hidden"
                        />
                        <img
                          src={`/icon-variations/${color.darkFile}`}
                          alt={`${design.name} - ${color.name}`}
                          width={40}
                          height={40}
                          className="hidden dark:block"
                        />
                      </>
                    ) : (
                      <img
                        src={`/icon-variations/${color.file}`}
                        alt={`${design.name} - ${color.name}`}
                        width={40}
                        height={40}
                      />
                    )}
                  </div>
                  <div className="text-sm font-medium">{color.name}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="text-center border-t pt-8">
        <p className="text-muted-foreground mb-4">
          View the{' '}
          <Link href="/docs" className="font-medium underline">
            documentation
          </Link>
        </p>
      </div>
    </div>
  );
}
