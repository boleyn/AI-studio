import { Check, Minus } from "lucide-react";
import styles from "./LibrarySelectionBox.module.css";

interface Props {
  label: string;
  checked: boolean;
  disabled?: boolean;
  mixed?: boolean;
  card?: boolean;
  onChange: () => void;
}
function SelectionMark({mixed,checked}:{mixed?:boolean;checked:boolean}) {
  return mixed ? <Minus size={12} strokeWidth={2.5} aria-hidden/> : checked ? <Check size={12} strokeWidth={2.5} aria-hidden/> : null;
}

export function LibrarySelectionIndicator({checked}:{checked:boolean}) {
  return <span aria-hidden className={styles.indicator} data-checked={checked}><SelectionMark checked={checked}/></span>;
}

export default function LibrarySelectionBox({label,checked,mixed,card,disabled,onChange}:Props) {
  return <button className={card ? styles.cardControl : styles.control} type="button" role="checkbox" aria-label={label}
    disabled={disabled} aria-checked={mixed ? "mixed" : checked} onClick={onChange}>
    <SelectionMark mixed={mixed} checked={checked}/>
  </button>;
}
