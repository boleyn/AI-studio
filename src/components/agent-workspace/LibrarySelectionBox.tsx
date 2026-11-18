import { Check, Minus } from "lucide-react";
import styles from "./LibrarySelectionBox.module.css";

interface Props {
  label: string;
  checked: boolean;
  mixed?: boolean;
  onChange: () => void;
}
export default function LibrarySelectionBox({label,checked,mixed,onChange}:Props) {
  return <button className={styles.control} type="button" role="checkbox" aria-label={label}
    aria-checked={mixed ? "mixed" : checked} onClick={onChange}>
    {mixed ? <Minus size={12} strokeWidth={2.5} aria-hidden/> : checked ? <Check size={12} strokeWidth={2.5} aria-hidden/> : null}
  </button>;
}
