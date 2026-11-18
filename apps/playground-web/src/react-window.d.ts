/* eslint-disable @typescript-eslint/no-explicit-any */
declare module "react-window" {
  import type { ComponentType, CSSProperties } from "react";

  export interface ListChildComponentProps<T = any> {
    index: number;
    style: CSSProperties;
    data: T;
  }

  export interface GridChildComponentProps<T = any> {
    columnIndex: number;
    rowIndex: number;
    style: CSSProperties;
    data: T;
  }

  export interface FixedSizeListProps<T = any> {
    children: ComponentType<ListChildComponentProps<T>>;
    height: number;
    itemCount: number;
    itemSize: number;
    width: number;
    itemData?: T;
    overscanCount?: number;
    className?: string;
    style?: CSSProperties;
    onScroll?: (props: { scrollOffset: number }) => void;
  }

  export interface FixedSizeGridProps<T = any> {
    children: ComponentType<GridChildComponentProps<T>>;
    columnCount: number;
    columnWidth: number;
    height: number;
    rowCount: number;
    rowHeight: number;
    width: number;
    itemData?: T;
    overscanColumnCount?: number;
    overscanRowCount?: number;
    className?: string;
    style?: CSSProperties;
  }

  export class FixedSizeList<T = any> extends React.Component<
    FixedSizeListProps<T>
  > {}
  export class FixedSizeGrid<T = any> extends React.Component<
    FixedSizeGridProps<T>
  > {}
}
