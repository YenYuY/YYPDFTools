# Third-party notices

## IMG.LY Background Removal

The optional image background-removal feature dynamically loads
[`@imgly/background-removal` 1.7.0](https://github.com/imgly/background-removal-js)
and its ONNX Runtime Web assets only when a user processes an image.

Copyright © IMG.LY GmbH and contributors. The package is available under the
[GNU Affero General Public License, version 3](https://github.com/imgly/background-removal-js/blob/main/LICENSE.md).
The unmodified upstream source is available from the linked repository.

Images selected by users remain in their browser. The browser downloads the
runtime and model assets, but image data is not sent to IMG.LY or this site's
hosting server.
