window.__ModuleLoader__.load({
	id: "dsh-LorebookMD",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/presets-api.ts
		async function callApi(payload) {
			const response = await fetch("/prompt-manager/api", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload)
			});
			if (!response.ok) throw new Error(`prompt-manager API responded ${String(response.status)}`);
			const reply = await response.json();
			if (!reply.ok) throw new Error(reply.error ?? "unknown prompt-manager API error");
			return reply;
		}
		function dataOf(reply) {
			return reply.data;
		}
		async function usePreset(name) {
			await callApi({
				op: "use",
				name
			});
		}
		async function deactivatePreset() {
			await callApi({ op: "off" });
		}
		async function importTavern(path, name) {
			return dataOf(await callApi({
				op: "importTavern",
				path,
				...name !== void 0 ? { name } : {}
			}));
		}
		async function importWorld(path, name, activate = false) {
			return dataOf(await callApi({
				op: "importWorld",
				path,
				...name !== void 0 ? { name } : {},
				...activate ? { activate: true } : {}
			}));
		}
		/** 世界书列表（含双预设名、条目数、本地文档路径与激活模式）。 */
		async function listWorlds() {
			return dataOf(await callApi({ op: "worlds" }));
		}
		/** 删除整组世界书（世界书预设 + 创作预设 + 本地文档）。 */
		async function removeWorld(name) {
			await callApi({
				op: "removeWorld",
				name
			});
		}
		/** 用系统默认程序打开世界书本地设定文档（worldbooks/<名>.md，供编辑）。 */
		async function openWorldDocument(name) {
			return dataOf(await callApi({
				op: "openDocument",
				name
			}));
		}
		//#endregion
		//#region \0dsh-css:G:\Program Files\deepseek_harness\workspase\dsh-LorebookMD\src\client\PresetsSection.module.css.mjs
		const css = "._5Cau2W_page{flex-direction:column;gap:12px;padding:4px 0 24px;display:flex}._5Cau2W_heading{margin:0;font-size:16px;font-weight:600}._5Cau2W_intro{opacity:.75;margin:0;font-size:13px;line-height:1.5}._5Cau2W_error{color:#d04848;background:#dc3c3c1f;border-radius:6px;margin:0;padding:8px 10px;font-size:13px}._5Cau2W_toolbar{flex-wrap:wrap;gap:8px;display:flex}._5Cau2W_list{flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;display:flex}._5Cau2W_item{border:1px solid #80808040;border-radius:8px;flex-direction:column;gap:6px;padding:10px 12px;display:flex}._5Cau2W_itemHeader{justify-content:space-between;align-items:center;gap:8px;display:flex}._5Cau2W_itemName{align-items:center;gap:8px;font-size:14px;font-weight:600;display:inline-flex}._5Cau2W_activeBadge{color:#3c9a4e;background:#50a05a2e;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500}._5Cau2W_worldBadge{color:#3a7cc0;background:#4682c82e;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500}._5Cau2W_itemDescription{opacity:.7;margin:0;font-size:12px}._5Cau2W_itemActions{gap:6px;display:inline-flex}._5Cau2W_editor{border-top:1px dashed #8080804d;flex-direction:column;gap:8px;padding-top:8px;display:flex}._5Cau2W_card{border:1px solid #80808040;border-radius:8px;flex-direction:column;gap:8px;padding:12px;display:flex}._5Cau2W_cardTitle{margin:0;font-size:13px;font-weight:600}._5Cau2W_field{opacity:.85;flex-direction:column;gap:4px;font-size:12px;display:flex}._5Cau2W_field input,._5Cau2W_field textarea{font:inherit;color:inherit;background:#80808014;border:1px solid #80808059;border-radius:6px;padding:6px 8px}._5Cau2W_field textarea{resize:vertical;font-family:ui-monospace,monospace;font-size:12px;line-height:1.5}._5Cau2W_actions{gap:8px;display:flex}._5Cau2W_button,._5Cau2W_buttonPrimary,._5Cau2W_buttonDanger{font:inherit;color:inherit;cursor:pointer;background:#8080801a;border:1px solid #80808059;border-radius:6px;padding:4px 12px;font-size:12px}._5Cau2W_buttonPrimary{color:#6aa8e0;background:#4682c82e;border-color:#4682c88c}._5Cau2W_button:hover,._5Cau2W_buttonPrimary:hover,._5Cau2W_buttonDanger:hover{background:#80808033}._5Cau2W_buttonPrimary:hover{background:#4682c847}._5Cau2W_button:disabled,._5Cau2W_buttonPrimary:disabled,._5Cau2W_buttonDanger:disabled{opacity:.5;cursor:default}._5Cau2W_buttonDanger{color:#d04848;border-color:#dc3c3c73}._5Cau2W_empty{opacity:.6;margin:0;font-size:13px}._5Cau2W_hint{opacity:.65;margin:0;font-size:12px;line-height:1.5}";
		const tagId = "dsh-LorebookMD/PresetsSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-LorebookMD";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var PresetsSection_module_css_default = {
			"actions": "_5Cau2W_actions",
			"item": "_5Cau2W_item",
			"editor": "_5Cau2W_editor",
			"itemHeader": "_5Cau2W_itemHeader",
			"activeBadge": "_5Cau2W_activeBadge",
			"page": "_5Cau2W_page",
			"itemActions": "_5Cau2W_itemActions",
			"list": "_5Cau2W_list",
			"button": "_5Cau2W_button",
			"card": "_5Cau2W_card",
			"cardTitle": "_5Cau2W_cardTitle",
			"worldBadge": "_5Cau2W_worldBadge",
			"empty": "_5Cau2W_empty",
			"intro": "_5Cau2W_intro",
			"itemName": "_5Cau2W_itemName",
			"toolbar": "_5Cau2W_toolbar",
			"itemDescription": "_5Cau2W_itemDescription",
			"hint": "_5Cau2W_hint",
			"buttonPrimary": "_5Cau2W_buttonPrimary",
			"field": "_5Cau2W_field",
			"buttonDanger": "_5Cau2W_buttonDanger",
			"error": "_5Cau2W_error",
			"heading": "_5Cau2W_heading"
		};
		//#endregion
		//#region src/client/PresetsSection.tsx
		/**
		* 世界书 · 小说创作设置页（settings.section 分区）。
		*
		* 数据经 host 的 `/prompt-manager/api`（同源 fetch）读写，与 host 半共享
		* 同一份 presets.json / worldbooks.json。界面聚焦小说创作场景：
		* - 世界书列表：一键「进入创作」（激活 ·创作 预设）或「世界书模式」（关键词触发）
		* - 导入：角色卡（内嵌世界书）或独立世界书 JSON
		* - 本地设定文档路径展示（worldbooks/<名>.md，可直接编辑）
		*/
		function PresetsSection(_props) {
			const [worlds, setWorlds] = (0, react.useState)([]);
			const [active, setActive] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)();
			const [busy, setBusy] = (0, react.useState)(false);
			const [cardPath, setCardPath] = (0, react.useState)("");
			const [worldPath, setWorldPath] = (0, react.useState)("");
			const refresh = (0, react.useCallback)(async () => {
				try {
					const next = await listWorlds();
					setActive(next.active);
					setWorlds(next.worlds);
					setError(void 0);
				} catch (cause) {
					setError(cause.message);
				}
			}, []);
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh]);
			async function run(action) {
				setBusy(true);
				setError(void 0);
				try {
					await action();
					await refresh();
				} catch (cause) {
					setError(cause.message);
				} finally {
					setBusy(false);
				}
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: PresetsSection_module_css_default.page,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: PresetsSection_module_css_default.heading,
						children: "世界书 · 小说创作"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PresetsSection_module_css_default.intro,
						children: "导入世界书（角色卡内嵌或独立 JSON），激活「创作」模式后输入场景，模型将参考设定创作小说。 每本世界书会生成创作预设与本地设定文档（worldbooks/<名>.md，可直接编辑）。"
					}),
					error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PresetsSection_module_css_default.error,
						children: error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PresetsSection_module_css_default.toolbar,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: PresetsSection_module_css_default.button,
							disabled: busy,
							onClick: () => {
								run(() => Promise.resolve());
							},
							children: "刷新"
						}), active !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: PresetsSection_module_css_default.button,
							disabled: busy,
							onClick: () => {
								run(deactivatePreset);
							},
							children: "停用当前模式"
						})]
					}),
					worlds.length === 0 && !busy && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PresetsSection_module_css_default.empty,
						children: "还没有世界书。用下方导入角色卡或世界书 JSON。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: PresetsSection_module_css_default.list,
						children: worlds.map((world) => {
							const writingActive = world.activeMode === "writing";
							const worldActive = world.activeMode === "world";
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: PresetsSection_module_css_default.item,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: PresetsSection_module_css_default.itemHeader,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: PresetsSection_module_css_default.itemName,
										children: [
											world.name,
											writingActive && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: PresetsSection_module_css_default.activeBadge,
												children: "创作模式中"
											}),
											worldActive && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: PresetsSection_module_css_default.worldBadge,
												children: "世界书模式"
											})
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: PresetsSection_module_css_default.itemActions,
										children: [
											!writingActive && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: PresetsSection_module_css_default.buttonPrimary,
												disabled: busy,
												onClick: () => {
													run(() => usePreset(world.writingPreset));
												},
												children: "进入创作"
											}),
											!worldActive && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: PresetsSection_module_css_default.button,
												disabled: busy,
												onClick: () => {
													run(() => usePreset(world.worldPreset));
												},
												children: "世界书模式"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: PresetsSection_module_css_default.button,
												disabled: busy,
												onClick: () => {
													run(() => openWorldDocument(world.name));
												},
												children: "编辑文档"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: PresetsSection_module_css_default.buttonDanger,
												disabled: busy,
												onClick: () => {
													if (confirm(`删除世界书 "${world.name}"（含创作预设与本地文档）？`)) run(() => removeWorld(world.name));
												},
												children: "删除"
											})
										]
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									className: PresetsSection_module_css_default.itemDescription,
									children: [
										world.entries,
										" 条设定条目 · 文档：",
										world.documentPath
									]
								})]
							}, world.name);
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PresetsSection_module_css_default.card,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: PresetsSection_module_css_default.cardTitle,
								children: "导入角色卡（.png / .json）"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: PresetsSection_module_css_default.field,
								children: ["文件路径", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									value: cardPath,
									onChange: (e) => {
										setCardPath(e.target.value);
									},
									placeholder: "C:/path/to/card.png"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: PresetsSection_module_css_default.hint,
								children: "角色卡内嵌的世界书（extensions.world / character_book）会生成「·世界书」「·创作」预设与本地设定文档。"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: PresetsSection_module_css_default.actions,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: PresetsSection_module_css_default.button,
									disabled: busy || cardPath.trim() === "",
									onClick: () => {
										const path = cardPath.trim();
										run(() => importTavern(path)).then(() => {
											setCardPath("");
										});
									},
									children: "导入"
								})
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PresetsSection_module_css_default.card,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: PresetsSection_module_css_default.cardTitle,
								children: "导入独立世界书（JSON）"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: PresetsSection_module_css_default.field,
								children: [
									"文件路径（",
									"{",
									" \"entries\": [...] ",
									"}",
									"）",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										value: worldPath,
										onChange: (e) => {
											setWorldPath(e.target.value);
										},
										placeholder: "C:/path/to/lorebook.json"
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: PresetsSection_module_css_default.actions,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: PresetsSection_module_css_default.button,
									disabled: busy || worldPath.trim() === "",
									onClick: () => {
										const path = worldPath.trim();
										run(() => importWorld(path, void 0, false)).then(() => {
											setWorldPath("");
										});
									},
									children: "导入"
								})
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		const name = "prompt-manager-client";
		const inject = ["slots"];
		function apply(ctx) {
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "prompt-presets",
				order: 25,
				label: () => "世界书创作"
			}, PresetsSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map