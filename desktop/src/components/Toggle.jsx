// Açma/kapama anahtarı: gerçek bir onay kutusu, anahtar gibi çiziliyor
// (stil: SettingsScreen.css, .settings-toggle / .settings-switch).
export function Toggle({ label, hint, checked, disabled, onChange }) {
  return (
    <label className={'settings-toggle' + (disabled ? ' settings-toggle--disabled' : '')}>
      <span className="settings-toggle-text">
        <strong>{label}</strong>
        {hint && <span className="field-hint">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="settings-switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}
