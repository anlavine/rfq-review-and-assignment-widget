import React from "react";
import css from "./Home.module.css";
import PendingRfqPackageList from "./components/PendingRfqPackageList";
function Home(): React.ReactElement {
  // See Ontology and Platform SDK docs in Developer Console on how to
  // use the client object to access Ontology resources and platform APIs
  return (
    <div className={css.home}>
      <PendingRfqPackageList />
    </div>
  );
}

export default Home;

