// 兼容策划文档中的文件名；实现集中在 phase-machine.ts，避免出现两套状态源。
export * from './phase-machine.ts';
export { PhaseMachine as StateMachine } from './phase-machine.ts';
