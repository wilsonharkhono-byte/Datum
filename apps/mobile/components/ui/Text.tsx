import { Text as RNText, type TextProps } from "react-native";

type Variant = "body" | "secondary" | "muted" | "heading" | "label";
const CLASS: Record<Variant, string> = {
  body: "text-text text-[15px] font-sans",
  secondary: "text-text-sec text-[13px] font-sans",
  muted: "text-text-muted text-[13px] font-sans",
  heading: "text-text text-[19px] font-semibold",
  label: "text-text-sec text-[12px] uppercase tracking-wide font-medium",
};

export function Text({ variant = "body", className = "", ...rest }: TextProps & { variant?: Variant; className?: string }) {
  return <RNText className={`${CLASS[variant]} ${className}`} {...rest} />;
}
