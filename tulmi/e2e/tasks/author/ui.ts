/**
 * UI TASKS: A COMPONENT FROM A DESCRIPTION, AND FROM A SCREENSHOT.
 *
 * Scored two ways: hidden DOM tests (Testing Library, in the project's own vitest) and the design compare: a hidden preview page mounts the component the
 * request names at its conventional path, Chromium shoots it, and the picture is compared to the reference in e2e/images (rendered from the oracle's
 * component by `tsx e2e/author.ts --images`). A task "from a screenshot" gives the bot that same picture.
 */
import type { Task } from "../schema.js";
import { task } from "./lib.js";

const viteHtml = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>preview</title></head>
  <body style="margin:0;background:#fff">
    <div id="e2e-target" style="display:inline-block;padding:16px;background:#fff"></div>
    <script type="module" src="/src/__e2e__/preview.tsx"></script>
  </body>
</html>
`;

const preview = (imports: string, body: string): string => `import { createRoot } from 'react-dom/client';

import '@/index.css';
${imports}

createRoot(document.getElementById('e2e-target') as HTMLElement).render(
${body}
);
`;

// -------------------------------------------------------------------- Badge

function badge(): Task {
  const component = `import * as React from 'react';

import { cn } from '@/utils/cn';

const variants = {
  default: 'bg-gray-100 text-gray-800',
  success: 'bg-green-100 text-green-800',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-800',
} as const;

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: keyof typeof variants;
};

export const Badge = ({
  variant = 'default',
  className,
  children,
  ...props
}: BadgeProps) => (
  <span
    role="status"
    data-variant={variant}
    className={cn(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
      variants[variant],
      className,
    )}
    {...props}
  >
    {children}
  </span>
);
`;
  const test = `import { render, screen } from '@testing-library/react';

import { Badge } from '@/components/ui/badge';

test('renders its children as a status', () => {
  render(<Badge>Paid</Badge>);
  const el = screen.getByRole('status');
  expect(el).toHaveTextContent('Paid');
  expect(el.tagName).toBe('SPAN');
});

test('is the default variant unless told otherwise', () => {
  render(<Badge>Draft</Badge>);
  const el = screen.getByRole('status');
  expect(el).toHaveAttribute('data-variant', 'default');
  expect(el.className).toContain('bg-gray-100');
  expect(el.className).toContain('text-gray-800');
});

test.each([
  ['success', 'bg-green-100', 'text-green-800'],
  ['warning', 'bg-amber-100', 'text-amber-800'],
  ['danger', 'bg-red-100', 'text-red-800'],
] as const)('the %s variant has its colours', (variant, bg, text) => {
  render(<Badge variant={variant}>x</Badge>);
  const el = screen.getByRole('status');
  expect(el).toHaveAttribute('data-variant', variant);
  expect(el.className).toContain(bg);
  expect(el.className).toContain(text);
});

test('is a small pill', () => {
  render(<Badge>x</Badge>);
  const cls = screen.getByRole('status').className;
  for (const c of ['inline-flex', 'rounded-full', 'text-xs', 'font-medium', 'px-2.5', 'py-0.5']) expect(cls).toContain(c);
});

test('a className is merged and wins over a conflicting default', () => {
  render(<Badge className="px-4 ml-2">x</Badge>);
  const cls = screen.getByRole('status').className;
  expect(cls).toContain('ml-2');
  expect(cls).toContain('px-4');
  expect(cls).not.toContain('px-2.5');
});

test('passes other attributes to the element', () => {
  render(<Badge id="state" title="The state">x</Badge>);
  const el = screen.getByRole('status');
  expect(el).toHaveAttribute('id', 'state');
  expect(el).toHaveAttribute('title', 'The state');
});
`;
  const hiddenPreview = preview(
    "import { Badge } from '@/components/ui/badge';",
    `  <div className="flex items-center gap-3">
    <Badge>Draft</Badge>
    <Badge variant="success">Paid</Badge>
    <Badge variant="warning">Due soon</Badge>
    <Badge variant="danger">Overdue</Badge>
  </div>,`,
  );
  return task({
    id: "bulletproof-vite-ui-badge",
    title: "A Badge component from a description",
    category: "ui",
    repo: "bulletproof-vite",
    request:
      "Add a `Badge` component in src/components/ui/badge (the component in badge.tsx, and an index.ts so it can be imported from '@/components/ui/badge'), like the other ui components. "
      + "It renders a `<span role=\"status\">` with a `data-variant` attribute holding its variant: `default` (the default), `success`, `warning` or `danger`. It is a small pill: classes inline-flex, items-center, rounded-full, px-2.5, py-0.5, text-xs and font-medium. "
      + "The colours by variant are gray (`bg-gray-100 text-gray-800`) for default, green (`bg-green-100 text-green-800`) for success, amber (`bg-amber-100 text-amber-800`) for warning and red (`bg-red-100 text-red-800`) for danger. "
      + "A `className` prop is merged in and wins over a conflicting default class (use the project's existing helper for that), and other props are passed to the span.",
    difficulty: 2,
    tags: ["ui", "bakeoff", "quick", "vite-react", "bulletproof-vite"],
    truth: { files: ["src/components/ui/badge/badge.tsx", "src/components/ui/badge/index.ts"], near: ["src/components/ui/button/button.tsx", "src/components/ui/button/index.ts"], allowed: ["^src/components/ui/badge/"] },
    hidden: {
      files: { "src/components/ui/badge/__tests__/badge.test.tsx": test, "__e2e_preview.html": viteHtml, "src/__e2e__/preview.tsx": hiddenPreview },
      run: ["src/components/ui/badge/__tests__/badge.test.tsx"], kind: "dom", minTests: 7,
    },
    oracle: { kind: "patch", files: { "src/components/ui/badge/badge.tsx": component, "src/components/ui/badge/index.ts": "export * from './badge';\n" }, classify: { type: "feature" }, plan: "Add the Badge component and its index next to the other ui components" },
    checks: { suite: true, questions: { max: 1 }, expectPr: true, design: { reference: "badge.png", route: "/__e2e_preview.html", minSimilarity: 0.88 } },
  });
}

// ----------------------------------------------------------------- StatCard

function statCard(): Task {
  const component = `import { cn } from '@/utils/cn';

export type StatCardProps = {
  label: string;
  value: string;
  delta?: number;
  period?: string;
  className?: string;
};

export const StatCard = ({
  label,
  value,
  delta,
  period = 'vs last month',
  className,
}: StatCardProps) => {
  const trend = delta === undefined ? undefined : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const sign = delta === undefined ? '' : delta > 0 ? '+' : '';
  return (
    <div
      className={cn(
        'w-64 rounded-lg border border-slate-200 bg-white p-5 shadow-sm',
        className,
      )}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-3xl font-bold text-slate-900">{value}</div>
      {delta !== undefined && (
        <div
          data-testid="delta"
          data-trend={trend}
          className="mt-3 flex items-center gap-1 text-sm"
        >
          <span
            className={cn(
              'font-semibold',
              trend === 'up' && 'text-green-600',
              trend === 'down' && 'text-red-600',
              trend === 'flat' && 'text-slate-500',
            )}
          >
            {trend === 'up' ? '▲ ' : trend === 'down' ? '▼ ' : ''}
            {sign}
            {delta}%
          </span>
          <span className="text-slate-500">{period}</span>
        </div>
      )}
    </div>
  );
};
`;
  const test = `import { render, screen } from '@testing-library/react';

import { StatCard } from '@/components/ui/stat-card';

test('shows the label and the value', () => {
  render(<StatCard label="Revenue" value="$48,200" />);
  expect(screen.getByText('Revenue')).toBeInTheDocument();
  expect(screen.getByText('$48,200')).toBeInTheDocument();
});

test('has no delta row without a delta', () => {
  render(<StatCard label="Revenue" value="$48,200" />);
  expect(screen.queryByTestId('delta')).toBeNull();
});

test('a positive delta is up, signed, with an up arrow and the default period', () => {
  render(<StatCard label="Revenue" value="$48,200" delta={12.5} />);
  const delta = screen.getByTestId('delta');
  expect(delta).toHaveAttribute('data-trend', 'up');
  expect(delta).toHaveTextContent('▲ +12.5%');
  expect(delta).toHaveTextContent('vs last month');
});

test('a negative delta is down with a down arrow and no extra sign', () => {
  render(<StatCard label="Churn" value="3.1%" delta={-3.2} />);
  const delta = screen.getByTestId('delta');
  expect(delta).toHaveAttribute('data-trend', 'down');
  expect(delta).toHaveTextContent('▼ -3.2%');
  expect(delta.textContent).not.toContain('--');
});

test('a zero delta is flat with no arrow', () => {
  render(<StatCard label="Users" value="900" delta={0} />);
  const delta = screen.getByTestId('delta');
  expect(delta).toHaveAttribute('data-trend', 'flat');
  expect(delta.textContent).not.toMatch(/[▲▼]/);
  expect(delta).toHaveTextContent('0%');
});

test('the period can be changed', () => {
  render(<StatCard label="Revenue" value="$1" delta={1} period="vs last week" />);
  expect(screen.getByTestId('delta')).toHaveTextContent('vs last week');
});

test('is a fixed-width white card with a border and a shadow', () => {
  const { container } = render(<StatCard label="Revenue" value="$1" />);
  const cls = (container.firstElementChild as HTMLElement).className;
  for (const c of ['w-64', 'rounded-lg', 'border', 'bg-white', 'p-5', 'shadow-sm']) expect(cls).toContain(c);
});
`;
  const hiddenPreview = preview(
    "import { StatCard } from '@/components/ui/stat-card';",
    "  <StatCard label=\"Revenue\" value=\"$48,200\" delta={12.5} />,",
  );
  return task({
    id: "bulletproof-vite-ui-statcard-shot",
    title: "A StatCard component from a screenshot",
    category: "ui",
    repo: "bulletproof-vite",
    request:
      "Build the card in the attached screenshot as a `StatCard` component in src/components/ui/stat-card (stat-card.tsx and an index.ts so it imports from '@/components/ui/stat-card'). "
      + "Props: `label` and `value` (strings), an optional `delta` (a number, a percentage change), an optional `period` (default \"vs last month\") and `className`. "
      + "The delta row is only there when `delta` is given: a positive delta shows an up arrow and a plus sign (\"▲ +12.5%\") in green, a negative one a down arrow (\"▼ -3.2%\") in red, zero shows \"0%\" in gray with no arrow; "
      + "put `data-testid=\"delta\"` and `data-trend=\"up\"`, `\"down\"` or `\"flat\"` on that row. Match the screenshot's look with the project's Tailwind classes.",
    images: ["statcard.png"],
    difficulty: 3,
    tags: ["ui", "screenshot", "bakeoff", "vite-react", "bulletproof-vite"],
    truth: { files: ["src/components/ui/stat-card/stat-card.tsx", "src/components/ui/stat-card/index.ts"], near: ["src/components/ui/button/button.tsx", "src/components/ui/button/index.ts"], allowed: ["^src/components/ui/stat-card/"] },
    hidden: {
      files: { "src/components/ui/stat-card/__tests__/stat-card.test.tsx": test, "__e2e_preview.html": viteHtml, "src/__e2e__/preview.tsx": hiddenPreview },
      run: ["src/components/ui/stat-card/__tests__/stat-card.test.tsx"], kind: "dom", minTests: 7,
    },
    oracle: { kind: "patch", files: { "src/components/ui/stat-card/stat-card.tsx": component, "src/components/ui/stat-card/index.ts": "export * from './stat-card';\n" }, classify: { type: "feature" }, plan: "Add the StatCard component and its index" },
    rubric: ["The result keeps the screenshot's structure: a small uppercase gray label, a large bold value, then a row with the change and the period", "The delta colours follow the request: green for up, red for down, gray for flat"],
    checks: { suite: true, questions: { max: 1 }, expectPr: true, design: { reference: "statcard.png", route: "/__e2e_preview.html", minSimilarity: 0.85 } },
  });
}

// --------------------------------------------------------------- EmptyState

function emptyState(): Task {
  const component = `import { Inbox } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/utils/cn';

export type EmptyStateProps = {
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
};

export const EmptyState = ({
  title,
  description,
  action,
  className,
}: EmptyStateProps) => (
  <section
    aria-labelledby="empty-state-title"
    className={cn(
      'flex w-80 flex-col items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center',
      className,
    )}
  >
    <Inbox aria-hidden="true" className="size-10 text-slate-400" />
    <h3 id="empty-state-title" className="text-lg font-semibold text-slate-900">
      {title}
    </h3>
    {description && <p className="text-sm text-slate-500">{description}</p>}
    {action && (
      <Button size="sm" onClick={action.onClick}>
        {action.label}
      </Button>
    )}
  </section>
);
`;
  const test = `import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EmptyState } from '@/components/ui/empty-state';

test('shows the title as a heading inside a labelled region', () => {
  render(<EmptyState title="No discussions yet" />);
  expect(screen.getByRole('heading', { name: 'No discussions yet' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'No discussions yet' })).toBeInTheDocument();
});

test('shows the description when there is one, and not when there is none', () => {
  const { rerender } = render(<EmptyState title="Empty" description="Start one to see it here." />);
  expect(screen.getByText('Start one to see it here.')).toBeInTheDocument();
  rerender(<EmptyState title="Empty" />);
  expect(screen.queryByText('Start one to see it here.')).toBeNull();
});

test('has an icon that screen readers skip', () => {
  const { container } = render(<EmptyState title="Empty" />);
  const svg = container.querySelector('svg');
  expect(svg).not.toBeNull();
  expect(svg).toHaveAttribute('aria-hidden', 'true');
});

test('an action is a button that calls its handler', async () => {
  const onClick = vi.fn();
  render(<EmptyState title="Empty" action={{ label: 'Create one', onClick }} />);
  await userEvent.click(screen.getByRole('button', { name: 'Create one' }));
  expect(onClick).toHaveBeenCalledTimes(1);
});

test('has no button without an action', () => {
  render(<EmptyState title="Empty" />);
  expect(screen.queryByRole('button')).toBeNull();
});

test('is a centred dashed box', () => {
  render(<EmptyState title="Empty" />);
  const cls = screen.getByRole('region').className;
  for (const c of ['flex', 'flex-col', 'items-center', 'text-center', 'border-dashed', 'rounded-lg']) expect(cls).toContain(c);
});
`;
  const hiddenPreview = preview(
    "import { EmptyState } from '@/components/ui/empty-state';",
    "  <EmptyState title=\"No discussions yet\" description=\"Start one and it will show up here.\" action={{ label: 'New discussion', onClick: () => undefined }} />,",
  );
  return task({
    id: "bulletproof-vite-ui-emptystate-shot",
    title: "An EmptyState component from a screenshot and a description",
    category: "ui",
    repo: "bulletproof-vite",
    request:
      "Add an `EmptyState` component in src/components/ui/empty-state (empty-state.tsx and an index.ts, importable from '@/components/ui/empty-state'), looking like the attached screenshot. "
      + "Props: `title`, an optional `description`, an optional `action` ({ label, onClick }) and `className`. It is a `<section>` labelled by its title, which is an h3; "
      + "above the title an inbox icon (the project already depends on lucide-react) that is hidden from screen readers; the description under it only when given; and the action as the project's own Button, only when given. "
      + "Use a dashed border and centred text as in the picture.",
    images: ["emptystate.png"],
    difficulty: 3,
    tags: ["ui", "screenshot", "bakeoff", "vite-react", "bulletproof-vite"],
    truth: { files: ["src/components/ui/empty-state/empty-state.tsx", "src/components/ui/empty-state/index.ts"], near: ["src/components/ui/button/button.tsx", "src/components/ui/button/index.ts"], allowed: ["^src/components/ui/empty-state/"] },
    hidden: {
      files: { "src/components/ui/empty-state/__tests__/empty-state.test.tsx": test, "__e2e_preview.html": viteHtml, "src/__e2e__/preview.tsx": hiddenPreview },
      run: ["src/components/ui/empty-state/__tests__/empty-state.test.tsx"], kind: "dom", minTests: 6,
    },
    oracle: { kind: "patch", files: { "src/components/ui/empty-state/empty-state.tsx": component, "src/components/ui/empty-state/index.ts": "export * from './empty-state';\n" }, classify: { type: "feature" }, plan: "Add the EmptyState component using lucide-react and the project's Button" },
    rubric: ["Uses the project's existing Button and lucide-react rather than new dependencies", "The structure matches the picture: icon, title, description, action button, in a dashed centred box"],
    checks: { suite: true, questions: { max: 1 }, expectPr: true, design: { reference: "emptystate.png", route: "/__e2e_preview.html", minSimilarity: 0.85 } },
  });
}

// ------------------------------------------------------------------- Avatar

function avatar(): Task {
  const component = `import { cn } from '@/utils/cn';

const sizes = { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-12 text-base' } as const;

export type AvatarProps = {
  name: string;
  src?: string;
  size?: keyof typeof sizes;
  className?: string;
};

export const initialsOf = (name: string): string =>
  name
    .trim()
    .split(/\\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');

export const Avatar = ({ name, src, size = 'md', className }: AvatarProps) => (
  <span
    data-size={size}
    className={cn(
      'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 font-medium text-slate-700',
      sizes[size],
      className,
    )}
  >
    {src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={name} className="size-full object-cover" />
    ) : (
      <span role="img" aria-label={name}>
        {initialsOf(name)}
      </span>
    )}
  </span>
);
`;
  const test = `import { render, screen } from '@testing-library/react';

import { Avatar, initialsOf } from '@/components/ui/avatar';

test('initials are the first letters of the first two words, upper case', () => {
  expect(initialsOf('ada lovelace')).toBe('AL');
  expect(initialsOf('Grace Brewster Murray Hopper')).toBe('GB');
  expect(initialsOf('  plato ')).toBe('P');
  expect(initialsOf('')).toBe('');
});

test('without an image it shows initials, labelled with the name', () => {
  render(<Avatar name="Ada Lovelace" />);
  const el = screen.getByRole('img', { name: 'Ada Lovelace' });
  expect(el).toHaveTextContent('AL');
});

test('with an image it shows the picture with the name as its alt text', () => {
  render(<Avatar name="Ada Lovelace" src="/ada.png" />);
  const img = screen.getByRole('img', { name: 'Ada Lovelace' });
  expect(img.tagName).toBe('IMG');
  expect(img).toHaveAttribute('src', '/ada.png');
});

test.each([
  ['sm', 'size-8'],
  ['md', 'size-10'],
  ['lg', 'size-12'],
] as const)('the %s size is %s', (size, cls) => {
  const { container } = render(<Avatar name="Ada" size={size} />);
  const root = container.firstElementChild as HTMLElement;
  expect(root).toHaveAttribute('data-size', size);
  expect(root.className).toContain(cls);
});

test('is medium and round by default, and merges a className', () => {
  const { container } = render(<Avatar name="Ada" className="ring-2" />);
  const root = container.firstElementChild as HTMLElement;
  expect(root).toHaveAttribute('data-size', 'md');
  expect(root.className).toContain('rounded-full');
  expect(root.className).toContain('ring-2');
});
`;
  const hiddenPage = `import { Avatar } from '@/components/ui/avatar';

const Page = () => (
  <div id="e2e-target" style={{ display: 'inline-block', padding: 16, background: '#fff' }}>
    <div className="flex items-center gap-3">
      <Avatar name="Ada Lovelace" size="sm" />
      <Avatar name="Grace Hopper" />
      <Avatar name="Plato" size="lg" />
    </div>
  </div>
);

export default Page;
`;
  return task({
    id: "bulletproof-next-ui-avatar",
    title: "An Avatar component in the Next.js app",
    category: "ui",
    repo: "bulletproof-next",
    request:
      "Add an `Avatar` component in src/components/ui/avatar (avatar.tsx and an index.ts so it imports from '@/components/ui/avatar'), and export a helper `initialsOf(name)` from it. "
      + "`initialsOf` gives the first letter of the first two words of the name, in upper case (\"ada lovelace\" is \"AL\", \"Grace Brewster Murray Hopper\" is \"GB\", an empty name is \"\"). "
      + "Props: `name`, an optional `src`, an optional `size` (`sm`, `md` default, `lg`) and `className`. The root is a round `<span>` with a `data-size` attribute and the size classes size-8, size-10 or size-12 "
      + "(use the project's class-merging helper so a className wins). With a `src` it shows an <img> whose alt text is the name; without one it shows the initials in an element with role=\"img\" and aria-label set to the name. "
      + "Style: rounded-full, bg-slate-200, text-slate-700, font-medium, centred.",
    difficulty: 3,
    tags: ["ui", "bakeoff", "nextjs", "bulletproof-next"],
    truth: { files: ["src/components/ui/avatar/avatar.tsx", "src/components/ui/avatar/index.ts"], near: ["src/components/ui/button/button.tsx", "src/components/ui/button/index.ts"], allowed: ["^src/components/ui/avatar/"] },
    hidden: {
      files: { "src/components/ui/avatar/__tests__/avatar.test.tsx": test, "src/app/e2e-preview/page.tsx": hiddenPage },
      run: ["src/components/ui/avatar/__tests__/avatar.test.tsx"], kind: "dom", minTests: 7,
    },
    oracle: { kind: "patch", files: { "src/components/ui/avatar/avatar.tsx": component, "src/components/ui/avatar/index.ts": "export * from './avatar';\n" }, classify: { type: "feature" }, plan: "Add the Avatar component with initialsOf and its index" },
    checks: { suite: true, questions: { max: 1 }, expectPr: true },
  });
}

export async function tasks(): Promise<Task[]> {
  return [badge(), statCard(), emptyState(), avatar()];
}
