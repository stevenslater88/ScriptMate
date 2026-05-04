export const useScriptStore = () => {
  return {
    scripts: [],
    fetchScripts: async () => {
      console.log("fetchScripts disabled");
      return [];
    },
    initializeUser: async () => {
      console.log("initializeUser disabled");
      return null;
    },
    createScript: async () => {
      console.log("createScript disabled");
      return null;
    },
    updateScript: async () => {
      console.log("updateScript disabled");
      return null;
    },
  };
};