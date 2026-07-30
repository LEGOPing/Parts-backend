//
//  PartSearchView.swift
//  PARTS
//
//  Created by Guo Ping Hu on 2026/2/14.
//

import SwiftUI
import CoreData
import Combine

// 导入必要的类型和视图
import Foundation















// 为View添加边框修饰符扩展
extension View {
    func borderBottom(bottom: Bool, color: Color) -> some View {
        self
            .overlay(
                Rectangle()
                    .frame(height: bottom ? 1 : 0)
                    .foregroundColor(color)
                    .alignmentGuide(.bottom) { d in d[.bottom] }
                , alignment: .bottom
            )
    }
}



// 为 Part 实体添加扩展，提供类型安全的属性访问
extension NSManagedObject {
    func getPartNum() -> String {
        return value(forKey: "part_num") as? String ?? "未定义"
    }
    
    func getPartName() -> String {
        return value(forKey: "name") as? String ?? "未定义"
    }
    
    func getColorId() -> Int32 {
        return value(forKey: "color_id") as? Int32 ?? 0
    }
    
    func getQuantity() -> Int32 {
        return value(forKey: "quantity") as? Int32 ?? 0
    }
    
    func setQuantity(_ quantity: Int32) {
        setValue(quantity, forKey: "quantity")
    }
    

    
    func getPartCatId() -> Int32 {
        if entity.attributesByName.keys.contains("part_cat_id") {
            return value(forKey: "part_cat_id") as? Int32 ?? 0
        }
        return 0
    }
    
    func getIsNew() -> Bool {
        if entity.attributesByName.keys.contains("is_new") {
            return value(forKey: "is_new") as? Bool ?? false
        }
        return false
    }
    
    func getBox() -> NSManagedObject? {
        if entity.relationshipsByName.keys.contains("box") {
            return value(forKey: "box") as? NSManagedObject
        }
        return nil
    }
}

// 紧凑筛选字段组件
struct CompactFilterField: View {
    let title: String
    @Binding var value: String
    @Binding var frame: CGRect?
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 14, weight: .medium))
            TextField("请输入\(title)", text: $value)
                .font(.system(size: 14))
                .padding(6)
                .border(Color.gray.opacity(0.3))
                .cornerRadius(4)
                .frame(height: 32) // 统一输入框高度
                .background(
                    GeometryReader { geometry in
                        Color.clear
                            .onAppear {
                                if frame != nil {
                                    frame = geometry.frame(in: .named("GeometryReader"))
                                    print("\(title)输入框坐标: \(frame!)")
                                }
                            }
                            .onChange(of: geometry.frame(in: .named("GeometryReader"))) { oldValue, newValue in
                                if frame != nil {
                                    frame = newValue
                                    print("\(title)输入框坐标已更新: \(frame!)")
                                }
                            }
                    }
                )
        }
        .padding(.horizontal, 15) // 与其他输入框保持一致的水平边距
    }
}

// 颜色选择器项目视图
struct ColorPickerItem: View {
    let color: (id: Int32, name: String, rgb: String)
    let isSelected: Bool
    let onSelect: () -> Void
    
    var body: some View {
        Button(action: onSelect) {
            VStack(spacing: 8) {
                // 颜色预览
                ZStack {
                    Color(rgbHex: color.rgb)
                        .frame(width: 60, height: 60)
                        .cornerRadius(8)
                        .border(isSelected ? Color.blue : Color.gray.opacity(0.3), width: 2)
                    if isSelected {
                        Image(systemName: "checkmark.circle.fill")
                            .resizable()
                            .frame(width: 24, height: 24)
                            .foregroundColor(.white)
                            .shadow(radius: 2)
                            .position(x: 50, y: 10) // 右上角
                    }
                }
                
                // 颜色信息
                VStack(spacing: 4) {
                    Text(color.name)
                        .font(.system(size: 12, weight: .medium))
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                    Text("ID: \(color.id)")
                        .font(.system(size: 10))
                        .foregroundColor(.gray)
                }
                .padding(8)
            }
            .padding(8)
            .background(isSelected ? Color.blue.opacity(0.1) : Color.white)
            .cornerRadius(8)
            .shadow(radius: 2)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

// 类别选择器项目视图
struct CategoryPickerItem: View {
    let category: (id: Int32, name: String)
    let isSelected: Bool
    let onSelect: () -> Void
    
    var body: some View {
        Button(action: onSelect) {
            VStack(spacing: 8) {
                // 类别信息
                VStack(spacing: 4) {
                    Text(category.name)
                        .font(.system(size: 12, weight: .medium))
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                    Text("ID: \(category.id)")
                        .font(.system(size: 10))
                        .foregroundColor(.gray)
                }
                .padding(12)
            }
            .padding(8)
            .background(isSelected ? Color.green.opacity(0.1) : Color.white)
            .cornerRadius(8)
            .border(isSelected ? Color.green : Color.gray.opacity(0.3), width: 1)
            .shadow(radius: 1)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

// 数量编辑弹窗视图
struct QuantityEditPopup: View {
    @Binding var isPresented: Bool
    @Binding var quantity: Int32
    @Binding var currentPart: NSManagedObject?
    @Environment(\.managedObjectContext) private var viewContext
    
    var body: some View {
        ZStack {
            // 半透明背景
            Color.black.opacity(0.5)
                .edgesIgnoringSafeArea(.all)
                .onTapGesture {
                    isPresented = false
                }
            
            // 弹窗内容
            VStack(spacing: 20) {
                Text("编辑数量")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(Color(red: 0x2c/255, green: 0x3e/255, blue: 0x50/255))
                
                // 数量输入
                HStack(spacing: 15) {
                    Button(action: {
                        if quantity > 0 {
                            quantity -= 1
                        }
                    }) {
                        Text("−")
                            .font(.system(size: 24, weight: .bold))
                            .foregroundColor(.white)
                            .frame(width: 40, height: 40)
                            .background(Color(red: 0xe7/255, green: 0x4c/255, blue: 0x3c/255))
                            .cornerRadius(20)
                    }
                    
                    Text("\(quantity)")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(Color(red: 0x2c/255, green: 0x3e/255, blue: 0x50/255))
                        .frame(minWidth: 80)
                    
                    Button(action: {
                        quantity += 1
                    }) {
                        Text("+")
                            .font(.system(size: 24, weight: .bold))
                            .foregroundColor(.white)
                            .frame(width: 40, height: 40)
                            .background(Color(red: 0x27/255, green: 0xae/255, blue: 0x60/255))
                            .cornerRadius(20)
                    }
                }
                
                // 按钮
                HStack(spacing: 20) {
                    Button(action: {
                        isPresented = false
                    }) {
                        Text("取消")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(.blue)
                            .padding(.horizontal, 30)
                            .padding(.vertical, 10)
                    }
                    
                    Button(action: {
                        // 保存数量
                        if let part = currentPart {
                            part.setQuantity(quantity)
                            do {
                                try viewContext.save()
                                print("数量更新成功: \(quantity)")
                                // 刷新搜索结果以显示更新后的数量
                                NotificationCenter.default.post(name: NSNotification.Name("RefreshSearchResults"), object: nil)
                            } catch {
                                print("数量更新失败: \(error)")
                            }
                        }
                        isPresented = false
                    }) {
                        Text("保存")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 30)
                            .padding(.vertical, 10)
                            .background(Color(red: 0x34/255, green: 0x98/255, blue: 0xdb/255))
                            .cornerRadius(5)
                    }
                }
            }
            .padding(30)
            .background(Color.white)
            .cornerRadius(10)
            .shadow(radius: 10)
            .frame(width: 300)
        }
    }
}

// 搜索结果项目视图
struct PartSearchResultItem: View {
    let part: NSManagedObject
    let onTap: () -> Void
    @ObservedObject var searchState: SearchState
    
    // 计算位置信息（仓库+"_"+盒子）
    private var locationText: String {
        var text = "未知位置"
        if let box = part.getBox() {
            let boxName = box.value(forKey: "name") as? String ?? ""
            if let repository = box.value(forKey: "repository") as? NSManagedObject {
                let repositoryName = repository.value(forKey: "name") as? String ?? ""
                text = "\(repositoryName)_\(boxName)"
            }
        }
        return text
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 6) { // 减少间距，采用紧凑设计
            // 零件图片（上方）
            PartImageLoader(
                partNum: part.getPartNum(),
                colorId: part.getColorId()
            )
                .frame(height: 80) // 减少图片高度
                .cornerRadius(4)
            
            // 零件型号和数量（左对齐，数量在右侧）
            HStack(alignment: .center, spacing: 8) { // 减少间距
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(part.getPartNum())
                        .font(.system(size: 11, weight: .bold)) // 减小字体
                        .foregroundColor(.primary)
                }
                Spacer()
                Text("\(part.getQuantity())")
                    .font(.system(size: 11, weight: .bold)) // 减小字体
                    .foregroundColor(.red)
            }
            
            // 零件名称（单行显示，可水平滚动）
            ScrollView(.horizontal, showsIndicators: false) {
                Text(part.getPartName())
                    .font(.system(size: 11)) // 减小字体
                    .foregroundColor(.gray)
                    .lineLimit(1)
            }
            
            // 显示颜色名称和零件状态（单行显示，可水平滚动）
            let colorId = part.getColorId()
            let colorName = getColorName(from: colorId) ?? "未知颜色"
            let isNew = part.getIsNew()
            let statusText = isNew ? "新" : "旧"
            let statusColor = isNew ? Color(red: 0x27/255, green: 0xae/255, blue: 0x60/255) : Color(red: 0x7f/255, green: 0x8c/255, blue: 0x8d/255)
            
            HStack {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(colorName)
                        .font(.system(size: 11)) // 减小字体
                        .foregroundColor(.gray)
                        .lineLimit(1)
                }
                Spacer()
                Text(statusText)
                    .font(.system(size: 10, weight: .medium)) // 减小字体
                    .foregroundColor(statusColor)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(statusColor.opacity(0.1))
                    .cornerRadius(3)
            }
            
            // 显示位置信息（单行显示，可水平滚动）
            ScrollView(.horizontal, showsIndicators: false) {
                Text(locationText)
                    .font(.system(size: 11)) // 减小字体
                    .foregroundColor(.gray)
                    .lineLimit(1)
            }
        }
        .padding(10) // 减少内边距
        .background(Color.white)
        .border(Color.gray.opacity(0.3))
        .cornerRadius(6) // 减小圆角
        .onLongPressGesture(minimumDuration: 0.5) {
            print("长按手势触发，显示数量编辑弹窗")
            searchState.editQuantity = part.getQuantity()
            searchState.currentEditingPart = part
            searchState.showQuantityEdit = true
        }
        .onTapGesture {
            onTap()
        }
    }
}

struct PartSearchView: View {
    @Environment(\.managedObjectContext) private var viewContext
    @Binding var currentState: ViewState
    // 使用全局搜索状态对象，确保状态不被重置
    @ObservedObject private var searchState = globalSearchState
    
    // 显式定义初始化器
    init(currentState: Binding<ViewState>) {
        self._currentState = currentState
    }

    var body: some View {
        return GeometryReader { geometry in
            ZStack(alignment: .topLeading) {
                // 命名坐标空间，用于获取输入框相对于GeometryReader的位置
                Color.clear
                    .coordinateSpace(name: "GeometryReader")
                    .onTapGesture {
                        // 点击外部区域时，退出联想器
                        if searchState.showPartNumberSuggestions {
                            print("点击外部区域，退出联想器")
                            searchState.showPartNumberSuggestions = false
                            searchState.partNumberSuggestions = []
                        }
                        if searchState.showPartNameSuggestions {
                            print("点击外部区域，退出零件名称联想器")
                            searchState.showPartNameSuggestions = false
                            searchState.partNameSuggestions = []
                        }
                    }
                    .onReceive(NotificationCenter.default.publisher(for: NSNotification.Name("RefreshSearchResults"))) {
                        _ in
                        print("收到刷新搜索结果通知")
                        // 重新执行搜索以刷新结果
                        searchParts()
                    }
                VStack(spacing: 0) {
                    // 上部：搜索条件（占1份）
                    VStack(spacing: 10) {
                        // 三列布局
                        HStack(spacing: 0) {
                            // 左边：型号、设计号、零件名称（38%宽度）
                            VStack(alignment: .leading, spacing: 10) {
                                // 型号（带联想功能）
                                PartNumberSuggestionPopupView(
                                    partNumberInput: $searchState.filterPartNum,
                                    showSuggestions: $searchState.showPartNumberSuggestions,
                                    suggestions: $searchState.partNumberSuggestions,
                                    inputBoxFrame: $searchState.inputBoxFrame,
                                    dataSource: PartNumberSuggestionManager.DataSource.system, // 从系统数据库获取数据
                                    onPartNumberChange: { newPartNumber in
                                        // 零件型号变化时的回调
                                        print("零件型号已更新: \(newPartNumber)")
                                        // 更新可用类别列表
                                        fetchAvailableCategories()
                                    }
                                )
                                
                                // 设计号
                                CompactFilterField(title: "设计号", value: $searchState.filterElementId, frame: $searchState.designNumberInputFrame)
                                
                                // 零件名称（带联想功能）
                                PartNameInputView(searchState: searchState)
                            }
                            .frame(width: geometry.size.width * 0.38)
                            
                            // 中间：颜色、类别、状态（31%宽度）
                            VStack(alignment: .leading, spacing: 10) {
                                // 颜色
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text("颜色")
                                            .font(.system(size: 14, weight: .medium))
                                        Spacer()
                                        Button(action: {
                                            searchState.showColorPicker.toggle()
                                        }) {
                                            Text("选择")
                                                .font(.system(size: 12))
                                                .foregroundColor(.blue)
                                        }
                                    }
                                    HStack {
                                        TextField("请输入颜色ID", text: $searchState.filterColorId)
                                            .font(.system(size: 14))
                                            .padding(6)
                                            .border(Color.gray.opacity(0.3))
                                            .cornerRadius(4)
                                            .frame(height: 32) // 统一输入框高度
                                        Spacer()
                                        TextField("请输入颜色名称", text: $searchState.filterColorName)
                                            .font(.system(size: 14))
                                            .padding(6)
                                            .border(Color.gray.opacity(0.3))
                                            .cornerRadius(4)
                                            .frame(height: 32) // 统一输入框高度
                                    }
                                }
                                .padding(.horizontal, 15) // 与其他输入框保持一致的水平边距
                                
                                // 类别
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text("类别")
                                            .font(.system(size: 14, weight: .medium))
                                        Spacer()
                                        Button(action: {
                                            searchState.showCategoryPicker.toggle()
                                        }) {
                                            Text("选择")
                                                .font(.system(size: 12))
                                                .foregroundColor(.blue)
                                        }
                                    }
                                    TextField("请输入类别", text: $searchState.filterCategory)
                                        .font(.system(size: 14))
                                        .padding(6)
                                        .border(Color.gray.opacity(0.3))
                                        .cornerRadius(4)
                                        .frame(height: 32) // 统一输入框高度
                                }
                                .padding(.horizontal, 15) // 与其他输入框保持一致的水平边距
                                
                                // 状态
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("状态")
                                        .font(.system(size: 14, weight: .medium))
                                    HStack(spacing: 10) {
                                        Button(action: {
                                            searchState.filterStatus = -1
                                        }) {
                                            Text("全部")
                                                .font(.system(size: 12))
                                                .foregroundColor(searchState.filterStatus == -1 ? .white : .primary)
                                                .padding(.horizontal, 12)
                                                .padding(.vertical, 6)
                                                .background(searchState.filterStatus == -1 ? Color.blue : Color.gray.opacity(0.2))
                                                .cornerRadius(4)
                                        }
                                        Button(action: {
                                            searchState.filterStatus = 0
                                        }) {
                                            Text("旧品")
                                                .font(.system(size: 12))
                                                .foregroundColor(searchState.filterStatus == 0 ? .white : .primary)
                                                .padding(.horizontal, 12)
                                                .padding(.vertical, 6)
                                                .background(searchState.filterStatus == 0 ? Color.blue : Color.gray.opacity(0.2))
                                                .cornerRadius(4)
                                        }
                                        Button(action: {
                                            searchState.filterStatus = 1
                                        }) {
                                            Text("新品")
                                                .font(.system(size: 12))
                                                .foregroundColor(searchState.filterStatus == 1 ? .white : .primary)
                                                .padding(.horizontal, 12)
                                                .padding(.vertical, 6)
                                                .background(searchState.filterStatus == 1 ? Color.blue : Color.gray.opacity(0.2))
                                                .cornerRadius(4)
                                        }
                                    }
                                }
                                .padding(.horizontal, 15) // 与其他输入框保持一致的水平边距
                            }
                            .frame(width: geometry.size.width * 0.31)
                            
                            // 右边：搜索按钮（31%宽度）
                            VStack(alignment: .center, spacing: 20) {
                                // 搜索按钮
                                Button(action: {
                                    searchParts()
                                }) {
                                    Text("搜索")
                                        .font(.system(size: 16, weight: .bold))
                                        .foregroundColor(.white)
                                        .padding(.horizontal, 40)
                                        .padding(.vertical, 15)
                                        .background(Color(red: 0x34/255, green: 0x98/255, blue: 0xdb/255))
                                        .cornerRadius(8)
                                }
                                
                                // 重置按钮
                                Button(action: {
                                    resetSearch()
                                }) {
                                    Text("重置")
                                        .font(.system(size: 16, weight: .bold))
                                        .foregroundColor(.blue)
                                        .padding(.horizontal, 40)
                                        .padding(.vertical, 15)
                                        .background(Color.white)
                                        .border(Color.blue, width: 1)
                                        .cornerRadius(8)
                                }
                                
                                // 筛选器状态
                                VStack(spacing: 8) {
                                    if !searchState.selectedColors.isEmpty {
                                        Text("已选择 \(searchState.selectedColors.count) 个颜色")
                                            .font(.system(size: 12))
                                            .foregroundColor(Color(red: 0x27/255, green: 0xae/255, blue: 0x60/255))
                                    }
                                    if !searchState.selectedCategories.isEmpty {
                                        Text("已选择 \(searchState.selectedCategories.count) 个类别")
                                            .font(.system(size: 12))
                                            .foregroundColor(Color(red: 0x27/255, green: 0xae/255, blue: 0x60/255))
                                    }
                                }
                            }
                            .frame(width: geometry.size.width * 0.31)
                        }
                    }
                    .frame(height: 220)
                    .background(Color.white)
                    .borderBottom(bottom: true, color: Color.gray.opacity(0.2))
                    
                    // 下部：搜索结果（占3份）
                    if searchState.showResults {
                        if searchState.isLoading {
                            // 加载状态
                            VStack(spacing: 20) {
                                ProgressView()
                                    .scaleEffect(2)
                                Text("正在搜索...")
                                    .font(.system(size: 16))
                                    .foregroundColor(Color(red: 0x7f/255, green: 0x8c/255, blue: 0x8d/255))
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .background(Color(red: 0xf5/255, green: 0xf5/255, blue: 0xf5/255))
                        } else if searchState.searchResults.isEmpty {
                            // 无结果状态
                            VStack(spacing: 20) {
                                Image(systemName: "magnifyingglass")
                                    .resizable()
                                    .scaledToFit()
                                    .frame(width: 100, height: 100)
                                    .foregroundColor(Color.gray.opacity(0.3))
                                Text("未找到匹配的零件")
                                    .font(.system(size: 16))
                                    .foregroundColor(Color(red: 0x7f/255, green: 0x8c/255, blue: 0x8d/255))
                                Text("请尝试调整搜索条件")
                                    .font(.system(size: 14))
                                    .foregroundColor(Color(red: 0x95/255, green: 0xa5/255, blue: 0xa6/255))
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .background(Color(red: 0xf5/255, green: 0xf5/255, blue: 0xf5/255))
                        } else {
                            // 搜索结果列表
                            ScrollView {
                                LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 6), spacing: 10) {
                                    ForEach(searchState.searchResults, id: \.objectID) { part in
                                        PartSearchResultItem(
                                            part: part,
                                            onTap: {
                                                // 点击零件查看详情
                                                currentState = .partDetail(part)
                                            },
                                            searchState: searchState
                                        )
                                    }
                                }
                                .padding(10)
                            }
                            .background(Color(red: 0xf5/255, green: 0xf5/255, blue: 0xf5/255))
                        }
                    } else {
                        // 初始状态
                        VStack(spacing: 40) {
                            Image(systemName: "magnifyingglass")
                                .resizable()
                                .scaledToFit()
                                .frame(width: 150, height: 150)
                                .foregroundColor(Color.gray.opacity(0.2))
                            Text("请输入搜索条件")
                                .font(.system(size: 18))
                                .foregroundColor(Color(red: 0x95/255, green: 0xa5/255, blue: 0xa6/255))
                            Text("然后点击搜索按钮开始查找零件")
                                .font(.system(size: 14))
                                .foregroundColor(Color(red: 0x95/255, green: 0xa5/255, blue: 0xa6/255))
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color(red: 0xf5/255, green: 0xf5/255, blue: 0xf5/255))
                    }
                }
                
                
                // 类别选择器弹窗
                if searchState.showCategoryPicker {
                    ZStack {
                        // 半透明背景
                        Color.black.opacity(0.5)
                            .edgesIgnoringSafeArea(.all)
                            .onTapGesture {
                                searchState.showCategoryPicker = false
                            }
                        
                        // 弹窗内容
                        VStack(spacing: 20) {
                            // 标题栏
                            HStack {
                                Text("选择类别")
                                    .font(.system(size: 18, weight: .bold))
                                    .foregroundColor(Color(red: 0x2c/255, green: 0x3e/255, blue: 0x50/255))
                                Spacer()
                                Button(action: {
                                    searchState.showCategoryPicker = false
                                }) {
                                    Text("关闭")
                                        .font(.system(size: 14))
                                        .foregroundColor(.blue)
                                }
                            }
                            .padding(.horizontal, 20)
                            .padding(.top, 20)
                            
                            // 类别列表
                            ScrollView {
                                if searchState.partsCountForCategory == 0 {
                                    // 没有找到零件
                                    VStack(spacing: 20) {
                                        Image(systemName: "folder")
                                            .resizable()
                                            .scaledToFit()
                                            .frame(width: 100, height: 100)
                                            .foregroundColor(Color.gray.opacity(0.3))
                                        Text("没有找到零件")
                                            .font(.system(size: 16))
                                            .foregroundColor(Color(red: 0x7f/255, green: 0x8c/255, blue: 0x8d/255))
                                        Text("请确保数据库中有零件数据")
                                            .font(.system(size: 14))
                                            .foregroundColor(Color(red: 0x95/255, green: 0xa5/255, blue: 0xa6/255))
                                    }
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                                } else if searchState.availableCategories.isEmpty {
                                    // 找到零件但类别加载失败
                                    VStack(spacing: 20) {
                                        Image(systemName: "folder")
                                            .resizable()
                                            .scaledToFit()
                                            .frame(width: 100, height: 100)
                                            .foregroundColor(Color.gray.opacity(0.3))
                                        Text("加载现有零件")
                                            .font(.system(size: 16))
                                            .foregroundColor(Color(red: 0x7f/255, green: 0x8c/255, blue: 0x8d/255))
                                        Text("零件数量: \(searchState.partsCountForCategory)")
                                            .font(.system(size: 14))
                                            .foregroundColor(Color(red: 0x95/255, green: 0xa5/255, blue: 0xa6/255))
                                        Text("类别加载失败")
                                            .font(.system(size: 14))
                                            .foregroundColor(Color(red: 0x95/255, green: 0xa5/255, blue: 0xa6/255))
                                    }
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                                } else {
                                    // 显示类别列表
                                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 120))], spacing: 15) {
                                        ForEach(searchState.availableCategories, id: \.id) {
                                            category in
                                            CategoryPickerItem(
                                                category: category,
                                                isSelected: searchState.selectedCategories.contains(category.id),
                                                onSelect: {
                                                    // 切换选择状态
                                                    if let index = searchState.selectedCategories.firstIndex(of: category.id) {
                                                        searchState.selectedCategories.remove(at: index)
                                                    } else {
                                                        searchState.selectedCategories.append(category.id)
                                                    }
                                                    
                                                    // 将选中的类别ID传送到类别ID输入框
                                                    searchState.filterCategory = searchState.selectedCategories.map { String($0) }.joined(separator: ", ")
                                                }
                                            )
                                        }
                                    }
                                    .padding(20)
                                }
                            }
                            
                            // 底部按钮
                            HStack(spacing: 20) {
                                Spacer()
                                
                                Button(action: {
                                    searchState.showCategoryPicker = false
                                }) {
                                    Text("返回")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(.white)
                                        .padding(.horizontal, 30)
                                        .padding(.vertical, 10)
                                        .background(Color(red: 0x34/255, green: 0x98/255, blue: 0xdb/255))
                                        .cornerRadius(5)
                                }
                            }
                            .padding(.horizontal, 20)
                            .padding(.bottom, 20)
                        }
                        .background(Color.white)
                        .cornerRadius(10)
                        .shadow(radius: 10)
                        .frame(width: min(geometry.size.width * 0.8, 600), height: min(geometry.size.height * 0.8, 600))
                        .position(x: geometry.size.width / 2, y: geometry.size.height / 2)
                    }
                }
                
                // 数量编辑弹窗
                if searchState.showQuantityEdit {
                    QuantityEditPopup(
                        isPresented: $searchState.showQuantityEdit,
                        quantity: $searchState.editQuantity,
                        currentPart: $searchState.currentEditingPart
                    )
                }
                
                // 零件型号联想弹窗 - 放在ZStack顶层
                if searchState.showPartNumberSuggestions && !searchState.partNumberSuggestions.isEmpty {
                    VStack(alignment: .leading, spacing: 2) { // 紧凑设计，减少间距
                        ScrollView {
                            VStack(alignment: .leading, spacing: 2) { // 紧凑设计，减少间距
                                ForEach(searchState.partNumberSuggestions, id: \.self) {
                                    suggestion in
                                    Button(action: {
                                        searchState.filterPartNum = suggestion.number
                                        // 手动触发零件型号变化的处理
                                        if !suggestion.number.isEmpty {
                                            // 清除之前的定时器，添加输入防抖
                                            // 这里可以添加其他处理逻辑
                                        } else {
                                            // 清除相关状态
                                        }
                                        searchState.showPartNumberSuggestions = false
                                    }) {
                                        HStack(alignment: .top, spacing: 8) { // 上对齐
                                            Text(suggestion.number)
                                                .font(.system(size: 14))
                                                .foregroundColor(.primary)
                                                .fixedSize(horizontal: true, vertical: true)
                                            Text(suggestion.name)
                                                .font(.system(size: 12))
                                                .foregroundColor(.gray)
                                                .lineLimit(2) // 允许显示两行
                                                .fixedSize(horizontal: false, vertical: true)
                                        }
                                        .padding(8) // 减少内边距，紧凑设计
                                        .background(Color.white)
                                        .border(Color.gray.opacity(0.2))
                                    }
                                }
                            }
                        }
                    }
                    .background(Color.white)
                    .cornerRadius(4)
                    .shadow(radius: 5)
                    .frame(maxWidth: 300) // 设置宽度
                    .frame(height: 400) // 调整高度，更加紧凑
                    .zIndex(1000) // 确保弹窗在最上层
                    .position(
                        x: (searchState.designNumberInputFrame ?? searchState.inputBoxFrame).minX + 150, // 设计号输入框左上角x坐标 + 选择器宽度的一半
                        y: (searchState.designNumberInputFrame ?? searchState.inputBoxFrame).minY + 150 // 设计号输入框左上角y坐标 + 选择器高度的一半
                    )
                    .gesture(
                        DragGesture(minimumDistance: 0, coordinateSpace: .global)
                            .onChanged { value in
                                // 计算新位置
                                let currentPosition = searchState.partNumberSuggestionPosition ?? CGPoint(
                                    x: (searchState.designNumberInputFrame ?? searchState.inputBoxFrame).minX + 150,
                                    y: (searchState.designNumberInputFrame ?? searchState.inputBoxFrame).minY + 150
                                )
                                let newPosition = CGPoint(
                                    x: currentPosition.x + value.translation.width,
                                    y: currentPosition.y + value.translation.height
                                )
                                // 保存新位置
                                searchState.partNumberSuggestionPosition = newPosition
                                print("型号联想器位置已更新: \(newPosition)")
                            }
                    )
                    .clipped() // 确保内容不会超出边界
                }
                
                // 零件名称联想弹窗 - 放在ZStack顶层
                PartNameSuggestionPopup(searchState: searchState, geometry: geometry)
            }
        }
        .sheet(isPresented: $searchState.showColorPicker) {
            ColorPickerView(partNumber: searchState.filterPartNum, onColorSelected: { selectedColorId in
                // 切换选择状态
                if let index = searchState.selectedColors.firstIndex(of: selectedColorId) {
                    searchState.selectedColors.remove(at: index)
                } else {
                    searchState.selectedColors.append(selectedColorId)
                }
                
                // 将选中的颜色ID传送到颜色ID输入框
                searchState.filterColorId = searchState.selectedColors.map { String($0) }.joined(separator: ", ")
            }, source: ColorPickerView.ColorPickerSource.searchPart, isMultiSelect: true, onApply: {
                searchParts()
            })
        }
        .onAppear {
            // 加载可用颜色和类别
            fetchAvailableColors()
            fetchAvailableCategories()
            
            // 检查是否有来自其他颜色按钮的搜索请求
            if let searchPartNumber = UserDefaults.standard.string(forKey: "searchPartNumber"), !searchPartNumber.isEmpty {
                print("从UserDefaults获取到搜索零件型号: \(searchPartNumber)")
                // 设置搜索框内容
                searchState.filterPartNum = searchPartNumber
                // 自动触发搜索
                searchParts()
                // 清除UserDefaults中的值，避免下次进入时再次触发
                UserDefaults.standard.removeObject(forKey: "searchPartNumber")
                print("已清除UserDefaults中的searchPartNumber")
            }
        }
    }
    
    // 获取可用颜色
    func fetchAvailableColors() {
        DispatchQueue.global(qos: .userInitiated).async {
            let persistence = PersistenceController.shared
            
            // 创建一个新的后台上下文用于查询主数据库
            let privateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
            privateContext.parent = persistence.container.viewContext
            
            var colors: [(id: Int32, name: String, rgb: String)] = []
            
            privateContext.performAndWait { 
                let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Part")
                
                // 根据零件型号筛选
                if !self.searchState.filterPartNum.isEmpty {
                    fetchRequest.predicate = NSPredicate(format: "part_num == %@", self.searchState.filterPartNum)
                }
                
                do {
                    let parts = try privateContext.fetch(fetchRequest)
                    
                    // 获取所有不同的颜色ID
                    var colorIds: Set<Int32> = []
                    for part in parts {
                        if let colorId = part.value(forKey: "color_id") as? Int32 {
                            colorIds.insert(colorId)
                        }
                    }
                    
                    // 从RB数据库中获取颜色信息
                    let rbPrivateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
                    rbPrivateContext.parent = persistence.rbContainer.viewContext
                    
                    rbPrivateContext.performAndWait { 
                        for colorId in colorIds {
                            let colorFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Colors")
                            colorFetchRequest.predicate = NSPredicate(format: "id == %d", colorId)
                            
                            do {
                                let colorResults = try rbPrivateContext.fetch(colorFetchRequest)
                                if let color = colorResults.first {
                                    if let name = color.value(forKey: "name") as? String,
                                       let rgb = color.value(forKey: "rgb") as? String {
                                        colors.append((id: colorId, name: name, rgb: rgb))
                                    }
                                }
                            } catch {
                                print("Error fetching color: \(error)")
                            }
                        }
                    }
                    
                    // 按颜色名称排序
                    colors.sort { $0.name < $1.name }
                    
                } catch {
                    print("Error fetching parts: \(error)")
                }
            }
            
            // 更新UI
            DispatchQueue.main.async {
                self.searchState.availableColors = colors
            }
        }
    }
    
    // 获取可用类别
    func fetchAvailableCategories() {
        DispatchQueue.global(qos: .userInitiated).async {
            let persistence = PersistenceController.shared
            
            var categories: [(id: Int32, name: String)] = []
            var partsCount = 0
            var hasCategoryIds = false
            
            // 从RB数据库的Parts表中获取类别信息
            let rbPrivateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
            rbPrivateContext.parent = persistence.rbContainer.viewContext
            
            rbPrivateContext.performAndWait { 
                if !self.searchState.filterPartNum.isEmpty {
                    // 当型号框有输入时，直接从RB数据库的Parts表中根据型号获取类别信息
                    let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Parts")
                    fetchRequest.predicate = NSPredicate(format: "part_num == %@", self.searchState.filterPartNum)
                    
                    do {
                        let parts = try rbPrivateContext.fetch(fetchRequest)
                        partsCount = parts.count
                        print("从RB数据库获取到零件数量: \(partsCount)")
                        
                        // 打印前5个零件的详细信息，以便调试
                        for (index, part) in parts.prefix(5).enumerated() {
                            let partNum = part.value(forKey: "part_num") as? String ?? "未知"
                            let categoryId = part.value(forKey: "part_cat_id") as? Int32 ?? -1
                            print("RB零件 \(index + 1): 型号=\(partNum), 类别ID=\(categoryId)")
                        }
                        
                        // 获取所有不同的类别ID
                        var categoryIds: Set<Int32> = []
                        for part in parts {
                            if let categoryId = part.value(forKey: "part_cat_id") as? Int32 {
                                categoryIds.insert(categoryId)
                                hasCategoryIds = true
                            }
                        }
                        print("获取到类别ID数量: \(categoryIds.count)")
                        print("类别ID列表: \(categoryIds)")
                        
                        if !categoryIds.isEmpty {
                            // 如果有类别ID，根据ID获取类别
                            for categoryId in categoryIds {
                                // 跳过类别ID为0的情况，因为这通常表示未分类
                                if categoryId == 0 {
                                    print("跳过类别ID为0的情况")
                                    continue
                                }
                                
                                let categoryFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Parts_categories")
                                categoryFetchRequest.predicate = NSPredicate(format: "id == %d", categoryId)
                                
                                do {
                                    let categoryResults = try rbPrivateContext.fetch(categoryFetchRequest)
                                    print("获取到类别结果数量: \(categoryResults.count) for ID: \(categoryId)")
                                    if let category = categoryResults.first {
                                        if let name = category.value(forKey: "name") as? String {
                                            categories.append((id: categoryId, name: name))
                                            print("添加类别: \(name) (ID: \(categoryId))")
                                        } else {
                                            // 如果没有找到类别名称，使用类别ID作为名称
                                            categories.append((id: categoryId, name: "类别 \(categoryId)"))
                                            print("添加类别: 类别 \(categoryId) (ID: \(categoryId))")
                                        }
                                    } else {
                                        // 如果没有找到类别，使用类别ID作为名称
                                        categories.append((id: categoryId, name: "类别 \(categoryId)"))
                                        print("添加类别: 类别 \(categoryId) (ID: \(categoryId))")
                                    }
                                } catch {
                                    print("Error fetching category: \(error)")
                                    // 发生错误时，使用类别ID作为名称
                                    categories.append((id: categoryId, name: "类别 \(categoryId)"))
                                    print("添加类别: 类别 \(categoryId) (ID: \(categoryId))")
                                }
                            }
                        } else {
                            // 如果没有类别ID，保持categories为空
                            print("没有从零件中找到类别ID，保持类别列表为空")
                        }
                    } catch {
                        print("Error fetching parts from RB database: \(error)")
                        // 发生错误时，保持类别列表为空
                    }
                } else {
                    // 当型号框没有输入时，从系统数据库的part表获得零件集
                    let systemPrivateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
                    systemPrivateContext.parent = persistence.container.viewContext
                    
                    var systemPartNumbers: Set<String> = []
                    
                    systemPrivateContext.performAndWait { 
                        let systemFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Part")
                        systemFetchRequest.propertiesToFetch = ["part_num"]
                        systemFetchRequest.returnsDistinctResults = true
                        
                        do {
                            let systemParts = try systemPrivateContext.fetch(systemFetchRequest)
                            partsCount = systemParts.count
                            print("从系统数据库获取到零件数量: \(partsCount)")
                            
                            // 提取所有不同的零件型号
                            for part in systemParts {
                                if let partNum = part.value(forKey: "part_num") as? String, !partNum.isEmpty {
                                    systemPartNumbers.insert(partNum)
                                }
                            }
                            print("获取到零件型号数量: \(systemPartNumbers.count)")
                            print("零件型号列表: \(Array(systemPartNumbers).prefix(10))...")
                        } catch {
                            print("Error fetching parts from system database: \(error)")
                        }
                    }
                    
                    // 根据系统数据库中的零件型号，在RB数据库的parts表获取相应类别ID
                    if !systemPartNumbers.isEmpty {
                        let rbFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Parts")
                        rbFetchRequest.predicate = NSPredicate(format: "part_num IN %@", Array(systemPartNumbers))
                        
                        do {
                            let rbParts = try rbPrivateContext.fetch(rbFetchRequest)
                            print("从RB数据库获取到匹配的零件数量: \(rbParts.count)")
                            
                            // 打印前5个匹配的零件信息，以便调试
                            for (index, part) in rbParts.prefix(5).enumerated() {
                                let partNum = part.value(forKey: "part_num") as? String ?? "未知"
                                let categoryId = part.value(forKey: "part_cat_id") as? Int32 ?? -1
                                print("RB匹配零件 \(index + 1): 型号=\(partNum), 类别ID=\(categoryId)")
                            }
                            
                            // 获取所有不同的类别ID
                            var categoryIds: Set<Int32> = []
                            for part in rbParts {
                                if let categoryId = part.value(forKey: "part_cat_id") as? Int32 {
                                    categoryIds.insert(categoryId)
                                    hasCategoryIds = true
                                }
                            }
                            print("获取到类别ID数量: \(categoryIds.count)")
                            print("类别ID列表: \(categoryIds)")
                            
                            if !categoryIds.isEmpty {
                                // 如果有类别ID，根据ID获取类别
                                for categoryId in categoryIds {
                                    // 跳过类别ID为0的情况，因为这通常表示未分类
                                    if categoryId == 0 {
                                        print("跳过类别ID为0的情况")
                                        continue
                                    }
                                    
                                    let categoryFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Parts_categories")
                                    categoryFetchRequest.predicate = NSPredicate(format: "id == %d", categoryId)
                                    
                                    do {
                                        let categoryResults = try rbPrivateContext.fetch(categoryFetchRequest)
                                        print("获取到类别结果数量: \(categoryResults.count) for ID: \(categoryId)")
                                        if let category = categoryResults.first {
                                            if let name = category.value(forKey: "name") as? String {
                                                categories.append((id: categoryId, name: name))
                                                print("添加类别: \(name) (ID: \(categoryId))")
                                            } else {
                                                // 如果没有找到类别名称，使用类别ID作为名称
                                                categories.append((id: categoryId, name: "类别 \(categoryId)"))
                                                print("添加类别: 类别 \(categoryId) (ID: \(categoryId))")
                                            }
                                        } else {
                                            // 如果没有找到类别，使用类别ID作为名称
                                            categories.append((id: categoryId, name: "类别 \(categoryId)"))
                                            print("添加类别: 类别 \(categoryId) (ID: \(categoryId))")
                                        }
                                    } catch {
                                        print("Error fetching category: \(error)")
                                        // 发生错误时，使用类别ID作为名称
                                        categories.append((id: categoryId, name: "类别 \(categoryId)"))
                                        print("添加类别: 类别 \(categoryId) (ID: \(categoryId))")
                                    }
                                }
                            } else {
                                // 如果没有类别ID，保持categories为空
                                print("没有从零件中找到类别ID，保持类别列表为空")
                            }
                        } catch {
                            print("Error fetching parts from RB database: \(error)")
                            // 发生错误时，保持类别列表为空
                        }
                    } else {
                        // 如果系统数据库中没有零件，保持categories为空
                        print("系统数据库中没有零件，保持类别列表为空")
                    }
                }
                
                // 按类别名称排序
                categories.sort { $0.name < $1.name }
                print("最终类别数量: \(categories.count)")
            }
            
            // 更新UI
            DispatchQueue.main.async {
                self.searchState.availableCategories = categories
                print("更新UI，可用类别数量: \(self.searchState.availableCategories.count)")
                
                // 存储零件数量和是否有类别ID的信息，用于UI显示
                self.searchState.partsCountForCategory = partsCount
                self.searchState.hasCategoryIds = hasCategoryIds
            }
        }
    }
    
    // 重置搜索
    func resetSearch() {
        searchState.filterPartNum = ""
        searchState.filterElementId = ""
        searchState.filterPartName = ""
        searchState.filterColorId = ""
        searchState.filterColorName = ""
        searchState.filterCategory = ""
        searchState.filterStatus = -1
        searchState.selectedColors = []
        searchState.selectedCategories = []
        searchState.searchResults = []
        searchState.showResults = false
    }
    
    // 根据设计号获取零件信息
    func getPartInfoByElementId(_ elementId: String) -> (partNums: [String], colorIds: [Int32])? {
        let persistence = PersistenceController.shared
        let rbPrivateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
        rbPrivateContext.parent = persistence.rbContainer.viewContext
        
        var partNums: [String] = []
        var colorIds: [Int32] = []
        
        rbPrivateContext.performAndWait { 
            let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Elements")
            fetchRequest.predicate = NSPredicate(format: "element_id == %@", elementId)
            
            do {
                let elements = try rbPrivateContext.fetch(fetchRequest)
                
                for element in elements {
                    if let partNum = element.value(forKey: "part_num") as? String {
                        partNums.append(partNum)
                    }
                    if let colorId = element.value(forKey: "color_id") as? Int32 {
                        colorIds.append(colorId)
                    }
                }
                
            } catch {
                print("Error fetching elements: \(error)")
            }
        }
        
        // 去重
        partNums = Array(Set(partNums))
        colorIds = Array(Set(colorIds))
        
        return (partNums: partNums, colorIds: colorIds)
    }
    
    // 移除所有空格
    func removeAllSpaces(_ text: String) -> String {
        return text.replacingOccurrences(of: " ", with: "")
    }
    

    
    func searchParts() {
        // 先刷新结果页面，清空搜索结果并显示加载状态
        searchState.isLoading = true
        searchState.searchResults = []
        searchState.showResults = true
        
        DispatchQueue.global(qos: .userInitiated).async {
            let persistence = PersistenceController.shared
            
            // 处理筛选条件
            let processedFilterPartNum = self.searchState.filterPartNum.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
            let processedFilterElementId = self.searchState.filterElementId.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
            let processedFilterPartName = self.searchState.filterPartName.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
            let processedFilterColorId = self.searchState.filterColorId.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
            let processedFilterColorName = self.searchState.filterColorName.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
            let processedFilterCategory = self.searchState.filterCategory.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
            
            var results: [NSManagedObject] = []
            
            persistence.container.viewContext.performAndWait { 
                let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Part")
                
                var predicates: [NSPredicate] = []
                
                // 处理零件型号筛选
                if !processedFilterPartNum.isEmpty {
                    predicates.append(NSPredicate(format: "part_num CONTAINS[cd] %@", processedFilterPartNum))
                }
                
                // 处理设计号筛选
                if !processedFilterElementId.isEmpty {
                    // 从缓存中获取设计号对应的零件信息
                    var partInfo: (partNums: [String], colorIds: [Int32])?
                    if let cachedInfo = searchState.elementIdToPartInfoCache[processedFilterElementId] {
                        partInfo = cachedInfo
                    } else {
                        partInfo = getPartInfoByElementId(processedFilterElementId)
                        // 缓存结果
                        if let info = partInfo {
                            searchState.elementIdToPartInfoCache[processedFilterElementId] = info
                        }
                    }
                    
                    if let partInfo = partInfo {
                        if !partInfo.partNums.isEmpty || !partInfo.colorIds.isEmpty {
                            if !partInfo.partNums.isEmpty {
                                // 使用IN谓词匹配多个零件型号
                                predicates.append(NSPredicate(format: "part_num IN %@", partInfo.partNums))
                            }
                            if !partInfo.colorIds.isEmpty {
                                // 使用IN谓词匹配多个颜色ID
                                predicates.append(NSPredicate(format: "color_id IN %@", partInfo.colorIds))
                            }
                        }
                    }
                }
                
                // 处理零件名称筛选
                if !processedFilterPartName.isEmpty {
                    predicates.append(NSPredicate(format: "name CONTAINS[cd] %@", processedFilterPartName))
                }
                
                // 处理颜色ID筛选
                if !processedFilterColorId.isEmpty {
                    if let colorId = Int32(processedFilterColorId) {
                        predicates.append(NSPredicate(format: "color_id == %d", colorId))
                    }
                }
                
                // 处理颜色名称筛选
                if !processedFilterColorName.isEmpty {
                    // 从缓存中获取颜色名称对应的颜色ID
                    var colorIds: [Int32] = []
                    if let cachedIds = searchState.colorNameToIdsCache[processedFilterColorName] {
                        colorIds = cachedIds
                    } else {
                        // 从RB数据库中获取颜色ID
                        let rbPrivateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
                        rbPrivateContext.parent = persistence.rbContainer.viewContext
                        
                        rbPrivateContext.performAndWait { 
                            let colorFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Colors")
                            colorFetchRequest.predicate = NSPredicate(format: "name CONTAINS[cd] %@", processedFilterColorName)
                            
                            do {
                                let colors = try rbPrivateContext.fetch(colorFetchRequest)
                                for color in colors {
                                    if let colorId = color.value(forKey: "id") as? Int32 {
                                        colorIds.append(colorId)
                                    }
                                }
                            } catch {
                                print("Error fetching colors: \(error)")
                            }
                        }
                        
                        // 缓存结果
                        searchState.colorNameToIdsCache[processedFilterColorName] = colorIds
                    }
                    
                    if !colorIds.isEmpty {
                        // 使用IN谓词匹配多个颜色ID
                        predicates.append(NSPredicate(format: "color_id IN %@", colorIds))
                    }
                }
                
                // 处理状态筛选
                if searchState.filterStatus != -1 {
                    predicates.append(NSPredicate(format: "is_new == %@", NSNumber(value: searchState.filterStatus == 1)))
                }
                
                // 处理颜色多选筛选
                if !self.searchState.selectedColors.isEmpty {
                    predicates.append(NSPredicate(format: "color_id IN %@", self.searchState.selectedColors))
                }
                
                // 处理类别筛选（包括输入框和选择器）
                var allCategoryIds: [Int32] = []
                
                // 1. 处理类别输入框
                if !processedFilterCategory.isEmpty {
                    // 从RB数据库中获取类别ID
                    let rbPrivateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
                    rbPrivateContext.parent = persistence.rbContainer.viewContext
                    
                    var categoryIds: [Int32] = []
                    
                    rbPrivateContext.performAndWait { 
                        // 尝试通过类别名称获取类别ID
                        let categoryFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Parts_categories")
                        categoryFetchRequest.predicate = NSPredicate(format: "name CONTAINS[cd] %@", processedFilterCategory)
                        
                        do {
                            let categories = try rbPrivateContext.fetch(categoryFetchRequest)
                            for category in categories {
                                if let categoryId = category.value(forKey: "id") as? Int32 {
                                    categoryIds.append(categoryId)
                                }
                            }
                        } catch {
                            print("Error fetching categories: \(error)")
                        }
                        
                        // 如果通过名称没有找到类别，尝试直接解析输入框中的数字作为类别ID
                        if categoryIds.isEmpty {
                            let numberFormatter = NumberFormatter()
                            if let categoryId = numberFormatter.number(from: processedFilterCategory)?.int32Value {
                                categoryIds.append(categoryId)
                            }
                        }
                    }
                    
                    allCategoryIds.append(contentsOf: categoryIds)
                }
                
                // 2. 处理类别选择器选择的类别
                if !self.searchState.selectedCategories.isEmpty {
                    allCategoryIds.append(contentsOf: self.searchState.selectedCategories)
                }
                
                // 去重
                allCategoryIds = Array(Set(allCategoryIds))
                
                if !allCategoryIds.isEmpty {
                    // 从RB数据库中获取属于这些类别的零件型号
                    let rbPrivateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
                    rbPrivateContext.parent = persistence.rbContainer.viewContext
                    
                    var partNumbers: [String] = []
                    
                    rbPrivateContext.performAndWait { 
                        let partsFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Parts")
                        partsFetchRequest.predicate = NSPredicate(format: "part_cat_id IN %@", allCategoryIds)
                        partsFetchRequest.propertiesToFetch = ["part_num"]
                        partsFetchRequest.returnsDistinctResults = true
                        
                        do {
                            let parts = try rbPrivateContext.fetch(partsFetchRequest)
                            for part in parts {
                                if let partNum = part.value(forKey: "part_num") as? String {
                                    partNumbers.append(partNum)
                                }
                            }
                        } catch {
                            print("Error fetching parts by category: \(error)")
                        }
                    }
                    
                    if !partNumbers.isEmpty {
                        // 使用IN谓词匹配多个零件型号
                        predicates.append(NSPredicate(format: "part_num IN %@", partNumbers))
                    }
                }
                
                // 组合谓词
                if !predicates.isEmpty {
                    let compoundPredicate = NSCompoundPredicate(andPredicateWithSubpredicates: predicates)
                    fetchRequest.predicate = compoundPredicate
                }
                
                do {
                    results = try persistence.container.viewContext.fetch(fetchRequest)
                    
                    // 对筛选器中的零件名称进行特殊处理：忽略空格
                    if !processedFilterPartName.isEmpty {
                        let filterTextWithoutSpaces = self.removeAllSpaces(processedFilterPartName)
                        results = results.filter { part in
                            if let partName = part.value(forKey: "name") as? String {
                                let partNameWithoutSpaces = self.removeAllSpaces(partName)
                                return partNameWithoutSpaces.contains(filterTextWithoutSpaces)
                            }
                            return false
                        }
                    }
                    
                } catch {
                    // 错误处理
                }
            }
            
            // 对结果进行排序：首先按零件型号排序，然后相同型号按颜色ID排序
            let sortedResults = results.sorted { (part1, part2) -> Bool in
                // 首先按零件型号排序
                let partNum1 = part1.value(forKey: "part_num") as? String ?? ""
                let partNum2 = part2.value(forKey: "part_num") as? String ?? ""
                
                if partNum1 != partNum2 {
                    return partNum1 < partNum2
                }
                
                // 相同型号按颜色ID排序
                let colorId1 = part1.value(forKey: "color_id") as? Int32 ?? 0
                let colorId2 = part2.value(forKey: "color_id") as? Int32 ?? 0
                
                return colorId1 < colorId2
            }
            
            DispatchQueue.main.async {
                self.searchState.searchResults = sortedResults
                self.searchState.showResults = true
                self.searchState.isLoading = false
            }
        }
    }
}
