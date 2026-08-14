/** CSS Modules 类型声明（client bundle 预设用 lightningcss 编译 .module.css）。 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
