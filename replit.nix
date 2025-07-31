{ pkgs }: {
  deps = [
    pkgs.nodejs_20
    pkgs.nodePackages.typescript-language-server
    pkgs.nodePackages.ts-node
    pkgs.cargo
    pkgs.sui
  ];
}
