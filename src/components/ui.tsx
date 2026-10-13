import type {
	ButtonHTMLAttributes,
	InputHTMLAttributes,
	ReactNode,
} from "react";
import brandMarkUrl from "~/assets/brand-mark.svg?url";

export type Provider = "plex" | "jellyfin";
export type Tone = "neutral" | "success" | "warning" | "danger";
type ButtonVariant = "primary" | "secondary" | "ghost";

export const PROVIDER_LABELS = {
	plex: "Plex",
	jellyfin: "Jellyfin",
} satisfies Record<Provider, string>;
const PROVIDER_DOT_CLASSES = {
	plex: "bg-plex",
	jellyfin: "bg-jellyfin",
} satisfies Record<Provider, string>;
const TONE_DOT_CLASSES = {
	neutral: "bg-faint",
	success: "bg-emerald-400",
	warning: "bg-amber-400",
	danger: "bg-red-400",
} satisfies Record<Tone, string>;
const NOTICE_CLASSES = {
	neutral: "border-line bg-raised text-muted",
	success: "border-emerald-400/25 bg-emerald-400/5 text-emerald-200",
	warning: "border-amber-400/25 bg-amber-400/5 text-amber-100",
	danger: "border-red-400/25 bg-red-400/5 text-red-200",
} satisfies Record<Tone, string>;
const BUTTON_VARIANT_CLASSES = {
	primary: "bg-ink text-canvas hover:bg-white",
	secondary:
		"border border-line-strong bg-surface text-ink hover:border-faint hover:bg-raised",
	ghost: "text-muted hover:bg-raised hover:text-ink",
} satisfies Record<ButtonVariant, string>;

export const focusRing =
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
// iOS Safari zooms on focus when input text is under 16px.
export const inputClass =
	"block w-full rounded-md border border-line-strong bg-canvas min-h-9 px-3 py-1.5 text-sm text-ink placeholder:text-faint pointer-coarse:min-h-11 pointer-coarse:text-base transition hover:border-faint focus:border-ink focus:outline-none disabled:opacity-50 aria-invalid:border-red-400/70";

export function buttonClass(variant: ButtonVariant = "secondary") {
	return `inline-flex min-h-9 shrink-0 pointer-coarse:min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${focusRing} ${BUTTON_VARIANT_CLASSES[variant]}`;
}

export function Button({
	variant,
	className = "",
	type = "button",
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
	return (
		<button
			type={type}
			className={`${buttonClass(variant)} ${className}`}
			{...props}
		/>
	);
}

export function Field({
	label,
	className = "",
	children,
}: {
	label: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the rule can't see the input or select callers pass as children.
		<label className={`grid gap-1.5 text-sm ${className}`}>
			<span className="font-medium text-muted">{label}</span>
			{children}
		</label>
	);
}

export function Toggle({
	label,
	...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string }) {
	return (
		<label className="inline-flex min-h-9 cursor-pointer items-center gap-2.5 text-sm pointer-coarse:min-h-11 text-muted has-disabled:cursor-not-allowed has-disabled:opacity-50">
			<input
				type="checkbox"
				className={`peer relative h-5 w-9 shrink-0 cursor-[inherit] appearance-none rounded-full bg-line-strong transition before:absolute before:top-0.5 before:left-0.5 before:size-4 before:rounded-full before:bg-muted before:transition checked:bg-ink checked:before:translate-x-4 checked:before:bg-canvas ${focusRing}`}
				{...props}
			/>
			{label}
		</label>
	);
}

export function Page({
	title,
	description,
	children,
}: {
	title: string;
	description: ReactNode;
	children: ReactNode;
}) {
	return (
		<main
			id="main-content"
			tabIndex={-1}
			className="mx-auto w-full max-w-5xl px-5 py-8 outline-none md:px-10 md:py-12"
		>
			<header className="mb-8">
				<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
				<p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p>
			</header>
			<div className="space-y-6">{children}</div>
		</main>
	);
}

export function Panel({
	id,
	title,
	description,
	actions,
	children,
}: {
	id: string;
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section
			aria-labelledby={id}
			className="rounded-lg border border-line bg-surface"
		>
			<header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
				<div className="min-w-0">
					<h2 id={id} className="text-sm font-semibold">
						{title}
					</h2>
					{description && (
						<p className="mt-0.5 text-sm text-muted">{description}</p>
					)}
				</div>
				{actions}
			</header>
			<div className="space-y-4 p-5">{children}</div>
		</section>
	);
}

export function ProviderLabel({
	provider,
	children,
}: {
	provider: Provider;
	children?: ReactNode;
}) {
	return (
		<span className="inline-flex items-center gap-2">
			<span
				aria-hidden="true"
				className={`size-2 rounded-full ${PROVIDER_DOT_CLASSES[provider]}`}
			/>
			{children ?? PROVIDER_LABELS[provider]}
		</span>
	);
}

export function StatusBadge({
	tone,
	children,
}: {
	tone: Tone;
	children: ReactNode;
}) {
	return (
		<span className="inline-flex items-center gap-1.5 text-xs text-muted">
			<span
				aria-hidden="true"
				className={`size-1.5 shrink-0 rounded-full ${TONE_DOT_CLASSES[tone]}`}
			/>
			{children}
		</span>
	);
}

export function Notice({
	tone,
	children,
}: {
	tone: Tone;
	children: ReactNode;
}) {
	return (
		<p
			role={tone === "danger" ? "alert" : "status"}
			className={`rounded-md border px-3 py-2 text-sm ${NOTICE_CLASSES[tone]}`}
		>
			{children}
		</p>
	);
}

export function EmptyState({ children }: { children: ReactNode }) {
	return <p className="px-5 py-8 text-center text-sm text-faint">{children}</p>;
}

export function BrandMark() {
	return <img src={brandMarkUrl} alt="" className="size-6 shrink-0" />;
}
