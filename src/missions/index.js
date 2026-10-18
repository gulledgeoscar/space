// Mission registry.
import { LaunchMission } from './mission1_launch.js';
import { WalkMission } from './mission2_walk.js';
import { FreeDockMission } from './mission6_freedock.js';

export const MISSION_CLASSES = {
  1: LaunchMission,
  2: WalkMission,
  6: FreeDockMission,
};
