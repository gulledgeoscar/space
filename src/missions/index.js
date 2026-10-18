// Mission registry.
import { LaunchMission } from './mission1_launch.js';
import { WalkMission } from './mission2_walk.js';
import { OceanMission } from './mission3_ocean.js';
import { IceMission } from './mission4_ice.js';
import { SpinDockMission } from './mission5_spin.js';
import { FreeDockMission } from './mission6_freedock.js';

export const MISSION_CLASSES = {
  1: LaunchMission,
  2: WalkMission,
  3: OceanMission,
  4: IceMission,
  5: SpinDockMission,
  6: FreeDockMission,
};
