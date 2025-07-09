const questData = require('../data/questData');

const findByTab = (tab) => {
  return questData[tab] || [];
};

const findById = (questId) => {
  for (const tab in questData) {
    const quest = questData[tab].find(q => q.id === questId);
    if (quest) {
      return quest;
    }
  }
  return null;
};

const update = (questId, updatedQuest) => {
  for (const tab in questData) {
    const questIndex = questData[tab].findIndex(q => q.id === questId);
    if (questIndex !== -1) {
      questData[tab][questIndex] = { ...questData[tab][questIndex], ...updatedQuest };
      return questData[tab][questIndex];
    }
  }
  return null;
};

module.exports = {
  findByTab,
  findById,
  update,
};
