import book from "/book.svg";

import React from "react";
import css from "./Osdk.module.css";

function Osdk(): React.ReactElement {
  return (
    <div className={css.osdk}>
      <div>
        <span>OSDK: </span>
        <span className={css.tag}>@rfq-review-hub-widget-application/sdk</span>
      </div>
      <a
        href="https://integrity.palantirfoundry.com/workspace/developer-console/app/ri.third-party-applications.main.application.95399229-983f-48c7-b4ff-35c1b3eadb9e/docs/guide/loading-data?language=typescript"
        className={css.docs}
        target="_blank"
        rel="noreferrer"
      >
        <img src={book} width={16} height={16} alt="Book icon"></img>
        <span>View documentation</span>
      </a>
    </div>
  );
}

export default Osdk;
