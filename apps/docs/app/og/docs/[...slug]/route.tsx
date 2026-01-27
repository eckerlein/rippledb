import { getPageImage, source } from '@/lib/source';
import { readFile } from 'fs/promises';
import { notFound } from 'next/navigation';
import { ImageResponse } from 'next/og';
import { join } from 'path';

export const revalidate = false;
export const dynamic = 'force-static';

function CustomOGImage({ description }: { description?: string }) {
  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%)',
        padding: '80px',
        fontFamily: 'Inter',
      }}
    >
      {/* Header with icon and site name */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
          marginBottom: '60px',
        }}
      >
        {/* Icon - recreated with basic shapes */}
        <div
          style={{
            width: '120',
            height: '120',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Outer circles */}
          <div
            style={{
              position: 'absolute',
              width: '66',
              height: '66',
              borderRadius: '50%',
              border: '4px solid',
              borderColor: 'rgba(59, 130, 246, 0.5)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              width: '90',
              height: '90',
              borderRadius: '50%',
              border: '6px solid',
              borderColor: 'rgba(59, 130, 246, 0.7)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              width: '110',
              height: '110',
              borderRadius: '50%',
              border: '4px solid',
              borderColor: 'rgba(59, 130, 246, 0.3)',
            }}
          />
          {/* Center circle with gradient */}
          <div
            style={{
              width: '32',
              height: '32',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
            }}
          />
          {/* Accent dots */}
          <div
            style={{
              position: 'absolute',
              top: '22',
              right: '22',
              width: '14',
              height: '14',
              borderRadius: '50%',
              background: '#60a5fa',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: '22',
              left: '22',
              width: '14',
              height: '14',
              borderRadius: '50%',
              background: '#7c3aed',
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div
            style={{
              fontSize: '48',
              fontWeight: 600,
              color: '#ffffff',
              display: 'flex',
              alignItems: 'baseline',
              gap: '4px',
              fontFamily: 'Inter',
            }}
          >
            <span>Ripple</span>
            <span
              style={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                color: 'transparent',
                fontWeight: 600,
                fontFamily: 'Inter',
              }}
            >
              DB
            </span>
          </div>
          <div
            style={{
              fontSize: '20',
              color: '#9ca3af',
            }}
          >
            Documentation
          </div>
        </div>
      </div>

      {/* Description */}
      {description && (
        <div
          style={{
            fontSize: '32',
            color: '#d1d5db',
            textAlign: 'center',
            maxWidth: '900px',
            lineHeight: '1.4',
          }}
        >
          {description}
        </div>
      )}
    </div>
  );
}

export async function GET(_req: Request, { params }: RouteContext<'/og/docs/[...slug]'>) {
  const { slug } = await params;
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();

  // Load Inter SemiBold font (static TTF, not variable font)
  // Place font file at: apps/docs/app/og/fonts/Inter_28pt-SemiBold.ttf
  // Or download from: https://fonts.google.com/specimen/Inter
  // Path is relative to monorepo root (where pnpm dev runs from)
  const fontPath = join(process.cwd(), '/app/og/fonts/Inter_28pt-SemiBold.ttf');
  let interSemiBold: Buffer | null = null;
  try {
    interSemiBold = await readFile(fontPath);
  } catch {
    // Font file not found, will use system font fallback
    console.warn(`Font file not found at ${fontPath}, using system font`);
  }

  return new ImageResponse(
    <CustomOGImage description={page.data.description} />,
    {
      width: 1200,
      height: 630,
      fonts: interSemiBold
        ? [
            {
              name: 'Inter',
              data: interSemiBold,
              style: 'normal',
              weight: 600, // SemiBold
            },
          ]
        : undefined,
    },
  );
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    slug: getPageImage(page).segments,
  }));
}
